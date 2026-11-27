package expo.modules.ecoute

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.Uri
import android.os.PowerManager
import android.provider.MediaStore
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class EcouteModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Contexte Android indisponible")

  // Focus audio « durable » pris pendant le tri. expo-audio ne demande qu'un focus temporaire :
  // Samsung Music se croit alors juste interrompu et reprend dès qu'un extrait s'arrête (au
  // swipe, à la fin des 30 s), ce qui faisait jouer les deux en même temps. Avec ce focus-là,
  // il reçoit une perte définitive et reste en pause.
  @Volatile private var focusRequest: AudioFocusRequest? = null
  @Volatile private var holding = false

  private val audioManager: AudioManager
    get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun hold() {
    if (holding) return
    val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
      )
      .setOnAudioFocusChangeListener { change ->
        // Une autre appli a repris la main pour de bon (tu relances Samsung Music, un appel...).
        if (change == AudioManager.AUDIOFOCUS_LOSS) release()
      }
      .build()
    if (audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      focusRequest = request
      holding = true
    }
  }

  private fun release() {
    focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
    focusRequest = null
    holding = false
  }

  private fun launch(intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  override fun definition() = ModuleDefinition {
    Name("Ecoute")

    // L'utilisateur a-t-il activé « Accès aux notifications » pour JukeBox ?
    Function("hasAccess") {
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }

    Function("openAccessSettings") {
      launch(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    Function("batteryUnrestricted") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("openBatterySettings") {
      try {
        launch(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
      } catch (_: Exception) {
        launch(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
      }
    }

    // Écoutes enregistrées depuis le dernier appel (lignes JSON), puis le fichier est vidé.
    // Pendant le tri : true avant chaque extrait (sans effet si déjà pris), false en quittant.
    Function("holdFocus") { on: Boolean ->
      if (on) hold() else release()
    }

    OnDestroy {
      release()
    }

    Function("drain") {
      EcouteService.drain(context)
    }

    Function("nowPlaying") {
      EcouteService.instance?.nowPlaying()
    }

    Function("trackedPackages") {
      val prefs = context.getSharedPreferences(EcouteService.PREFS, Context.MODE_PRIVATE)
      (prefs.getStringSet(EcouteService.KEY_PACKAGES, EcouteService.DEFAULT_PACKAGES)
        ?: EcouteService.DEFAULT_PACKAGES).toList()
    }

    Function("setTrackedPackages") { packages: List<String> ->
      context.getSharedPreferences(EcouteService.PREFS, Context.MODE_PRIVATE)
        .edit().putStringSet(EcouteService.KEY_PACKAGES, packages.toSet()).apply()
    }

    // Playlists partagées (celles de Samsung Music y apparaissent) avec leurs titres.
    AsyncFunction("playlists") {
      val out = mutableListOf<Map<String, Any?>>()
      @Suppress("DEPRECATION")
      val listUri = MediaStore.Audio.Playlists.EXTERNAL_CONTENT_URI
      @Suppress("DEPRECATION")
      val listProjection = arrayOf(MediaStore.Audio.Playlists._ID, MediaStore.Audio.Playlists.NAME)
      context.contentResolver.query(listUri, listProjection, null, null, null)?.use { c ->
        while (c.moveToNext()) {
          val id = c.getLong(0)
          val name = c.getString(1) ?: continue
          val tracks = mutableListOf<Map<String, String?>>()
          @Suppress("DEPRECATION")
          val membersUri = MediaStore.Audio.Playlists.Members.getContentUri("external", id)
          try {
            context.contentResolver.query(
              membersUri,
              arrayOf(MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST),
              null, null, null,
            )?.use { m ->
              while (m.moveToNext()) tracks.add(mapOf("title" to m.getString(0), "artist" to m.getString(1)))
            }
          } catch (_: Exception) {
            // Playlist illisible : on l'ignore.
          }
          out.add(mapOf("name" to name, "tracks" to tracks))
        }
      }
      out
    }

    // Toute la musique du téléphone (titre, artiste, album, durée, dossier).
    AsyncFunction("library") {
      val out = mutableListOf<Map<String, Any?>>()
      val projection = arrayOf(
        MediaStore.Audio.Media._ID,
        MediaStore.Audio.Media.TITLE,
        MediaStore.Audio.Media.ARTIST,
        MediaStore.Audio.Media.ALBUM,
        MediaStore.Audio.Media.DURATION,
        MediaStore.Audio.Media.RELATIVE_PATH,
        MediaStore.Audio.Media.DATE_ADDED,
      )
      val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      context.contentResolver.query(uri, projection, "${MediaStore.Audio.Media.IS_MUSIC} != 0", null, null)?.use { c ->
        val id = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
        val title = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
        val artist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
        val album = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
        val duration = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
        val path = c.getColumnIndexOrThrow(MediaStore.Audio.Media.RELATIVE_PATH)
        val added = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
        while (c.moveToNext()) {
          out.add(mapOf(
            "uri" to ContentUris.withAppendedId(uri, c.getLong(id)).toString(),
            "title" to c.getString(title),
            "artist" to c.getString(artist),
            "album" to c.getString(album),
            "durationMs" to c.getLong(duration).toDouble(),
            "path" to c.getString(path),
            "addedAt" to c.getLong(added).toDouble() * 1000,
          ))
        }
      }
      out
    }
  }
}
