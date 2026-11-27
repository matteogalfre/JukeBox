package expo.modules.ecoute

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import org.json.JSONObject
import java.io.File

/**
 * Suit les sessions média des lecteurs choisis (Samsung Music par défaut).
 *
 * On ne lit aucune notification : Android exige ce type de service pour donner accès aux
 * sessions média des autres applis. Chaque titre joué devient une ligne JSON dans
 * `ecoutes.jsonl` (titre, artiste, durée, temps réellement écouté). L'appli la lit à
 * l'ouverture et décide si c'est une écoute, un passage rapide ou une écoute partielle.
 */
class EcouteService : NotificationListenerService() {

  private class Piste(
    val title: String,
    val artist: String,
    val album: String,
    val durationMs: Long,
    val pkg: String,
  ) {
    val startedAt: Long = System.currentTimeMillis()
    var playedMs: Long = 0
    var playingSince: Long? = null

    fun key() = "$pkg|$title|$artist"

    fun played(now: Long): Long = playedMs + (playingSince?.let { now - it } ?: 0)
  }

  private val handler = Handler(Looper.getMainLooper())
  private val controllers = mutableMapOf<SessionKey, Pair<MediaController, MediaController.Callback>>()
  private var current: Piste? = null
  private var lastPosition: Long = 0
  private var sessionManager: MediaSessionManager? = null

  // Petite clé pour retrouver un contrôleur sans dépendre de l'égalité des objets.
  private data class SessionKey(val pkg: String, val token: Int)

  private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { list ->
    attach(list ?: emptyList())
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    instance = this
    val msm = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    sessionManager = msm
    val me = ComponentName(this, EcouteService::class.java)
    try {
      msm.addOnActiveSessionsChangedListener(sessionsListener, me, handler)
      attach(msm.getActiveSessions(me))
    } catch (_: SecurityException) {
      // Accès retiré entre-temps : rien à suivre.
    }
  }

  override fun onListenerDisconnected() {
    finish()
    detachAll()
    sessionManager?.removeOnActiveSessionsChangedListener(sessionsListener)
    if (instance === this) instance = null
    super.onListenerDisconnected()
  }

  override fun onDestroy() {
    finish()
    detachAll()
    if (instance === this) instance = null
    super.onDestroy()
  }

  private fun tracked(pkg: String): Boolean {
    val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val set = prefs.getStringSet(KEY_PACKAGES, DEFAULT_PACKAGES) ?: DEFAULT_PACKAGES
    return pkg in set
  }

  private fun attach(list: List<MediaController>) {
    val wanted = list.filter { tracked(it.packageName) }
    val keys = wanted.map { SessionKey(it.packageName, it.sessionToken.hashCode()) }.toSet()
    // Détache les sessions disparues.
    controllers.keys.filter { it !in keys }.forEach { key ->
      controllers.remove(key)?.let { (c, cb) -> c.unregisterCallback(cb) }
    }
    for (controller in wanted) {
      val key = SessionKey(controller.packageName, controller.sessionToken.hashCode())
      if (key in controllers) continue
      val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = onMetadata(controller, metadata)
        override fun onPlaybackStateChanged(state: PlaybackState?) = onState(state)
        override fun onSessionDestroyed() {
          finish()
          controllers.remove(key)
        }
      }
      controller.registerCallback(callback, handler)
      controllers[key] = controller to callback
      onMetadata(controller, controller.metadata)
      onState(controller.playbackState)
    }
  }

  private fun detachAll() {
    controllers.values.forEach { (c, cb) -> c.unregisterCallback(cb) }
    controllers.clear()
  }

  private fun onMetadata(controller: MediaController, metadata: MediaMetadata?) {
    if (metadata == null) return
    val title = metadata.getString(MediaMetadata.METADATA_KEY_TITLE)?.trim().orEmpty()
    val artist = (metadata.getString(MediaMetadata.METADATA_KEY_ARTIST)
      ?: metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST))?.trim().orEmpty()
    if (title.isEmpty()) return
    val album = metadata.getString(MediaMetadata.METADATA_KEY_ALBUM)?.trim().orEmpty()
    val duration = metadata.getLong(MediaMetadata.METADATA_KEY_DURATION)
    val next = Piste(title, artist, album, duration, controller.packageName)
    if (current?.key() == next.key()) return
    val wasPlaying = current?.playingSince != null ||
      controller.playbackState?.state == PlaybackState.STATE_PLAYING
    finish()
    current = next
    lastPosition = 0
    if (wasPlaying) next.playingSince = SystemClock.elapsedRealtime()
  }

  private fun onState(state: PlaybackState?) {
    val piste = current ?: return
    val now = SystemClock.elapsedRealtime()
    val playing = state?.state == PlaybackState.STATE_PLAYING
    val position = state?.position ?: 0

    // Même titre relancé depuis le début (répétition) : on clôt l'écoute précédente.
    if (playing && position in 0..3000 && lastPosition > 30000 && piste.played(now) > 30000) {
      val again = Piste(piste.title, piste.artist, piste.album, piste.durationMs, piste.pkg)
      finish()
      current = again
      again.playingSince = now
      lastPosition = position
      return
    }
    if (position > 0) lastPosition = position

    if (playing && piste.playingSince == null) {
      piste.playingSince = now
    } else if (!playing && piste.playingSince != null) {
      piste.playedMs += now - (piste.playingSince ?: now)
      piste.playingSince = null
    }
  }

  /** Clôt le titre en cours et l'écrit s'il a été écouté au moins 3 secondes. */
  private fun finish() {
    val piste = current ?: return
    current = null
    val played = piste.played(SystemClock.elapsedRealtime())
    if (played < 3000) return
    val line = JSONObject()
      .put("startedAt", piste.startedAt)
      .put("endedAt", System.currentTimeMillis())
      .put("title", piste.title)
      .put("artist", piste.artist)
      .put("album", piste.album)
      .put("durationMs", piste.durationMs)
      .put("playedMs", played)
      .put("pkg", piste.pkg)
    append(this, line.toString())
  }

  fun nowPlaying(): Map<String, Any>? {
    val piste = current ?: return null
    return mapOf(
      "title" to piste.title,
      "artist" to piste.artist,
      "album" to piste.album,
      "playing" to (piste.playingSince != null),
      "playedMs" to piste.played(SystemClock.elapsedRealtime()).toDouble(),
    )
  }

  companion object {
    const val PREFS = "jukebox_ecoute"
    const val KEY_PACKAGES = "packages"
    val DEFAULT_PACKAGES = setOf("com.sec.android.app.music")
    private const val FILE = "ecoutes.jsonl"
    private val lock = Any()

    @Volatile
    var instance: EcouteService? = null

    fun append(context: Context, line: String) {
      synchronized(lock) {
        File(context.filesDir, FILE).appendText(line + "\n")
      }
    }

    /** Renvoie les lignes en attente et vide le fichier. */
    fun drain(context: Context): String {
      synchronized(lock) {
        val file = File(context.filesDir, FILE)
        if (!file.exists()) return ""
        val text = file.readText()
        file.delete()
        return text
      }
    }
  }
}
