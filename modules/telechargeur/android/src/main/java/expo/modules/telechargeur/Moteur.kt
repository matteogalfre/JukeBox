package expo.modules.telechargeur

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import com.mpatric.mp3agic.ID3v24Tag
import com.mpatric.mp3agic.Mp3File
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** yt-dlp + ffmpeg embarqués, tags ID3 depuis Deezer, rangement dans la musique du téléphone. */
object Moteur {
  @Volatile
  private var ready = false
  private val lock = Any()
  private const val RESULTS = "telechargements.jsonl"
  const val DISCOVERIES = "Music/JukeBox/Découvertes"

  fun init(context: Context) {
    if (ready) return
    synchronized(lock) {
      if (ready) return
      YoutubeDL.getInstance().init(context.applicationContext)
      FFmpeg.getInstance().init(context.applicationContext)
      ready = true
    }
  }

  data class Job(
    val id: String,
    val title: String,
    val artist: String,
    val album: String,
    val year: String,
    val trackNumber: Int,
    val durationS: Double,
    val coverUrl: String,
  ) {
    companion object {
      fun parse(json: String): Job {
        val o = JSONObject(json)
        return Job(
          id = o.getString("id"),
          title = o.getString("title"),
          artist = o.getString("artist"),
          album = o.optString("album"),
          year = o.optString("year"),
          trackNumber = o.optInt("trackNumber", 0),
          durationS = o.optDouble("durationS", 0.0),
          coverUrl = o.optString("coverUrl"),
        )
      }
    }
  }

  private fun search(query: String): List<Recherche.Candidat> {
    val request = YoutubeDLRequest("ytsearch6:$query")
      .addOption("--flat-playlist")
      .addOption("-J")
      .addOption("--no-warnings")
    val out = YoutubeDL.getInstance().execute(request, processId = null, redirectErrorStream = false, callback = null).out
    val entries = JSONObject(out).optJSONArray("entries") ?: return emptyList()
    return (0 until entries.length()).mapNotNull { i ->
      val e = entries.optJSONObject(i) ?: return@mapNotNull null
      val id = e.optString("id")
      if (id.isEmpty()) null else Recherche.Candidat(
        id = id,
        title = e.optString("title"),
        channel = e.optString("channel", e.optString("uploader")),
        duration = e.optDouble("duration", 0.0).let { if (it.isNaN()) 0.0 else it },
      )
    }
  }

  /** Meilleure vidéo pour ce titre, ou null si rien n'est assez sûr. */
  fun pick(job: Job): Pair<Recherche.Candidat, Double>? {
    val queries = listOf("${job.artist} ${job.title}", "${job.artist} ${job.title} audio")
    var best: Recherche.Candidat? = null
    var bestScore = -99.0
    val seen = mutableSetOf<String>()
    for (q in queries) {
      for (c in search(q)) {
        if (!seen.add(c.id)) continue
        val s = Recherche.score(c, job.artist, job.title, job.album, job.durationS)
        if (s > bestScore) { best = c; bestScore = s }
      }
      if (bestScore >= 0.9) break
    }
    val chosen = best ?: return null
    return if (bestScore >= 0.45) chosen to bestScore else null
  }

  private fun fetch(url: String): ByteArray? = try {
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 15000
    conn.readTimeout = 20000
    conn.inputStream.use { it.readBytes() }
  } catch (_: Exception) {
    null
  }

  private fun safeName(text: String): String =
    text.replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001f]"), "-").replace(Regex("\\s+"), " ").trim(' ', '.').take(90)
      .ifEmpty { "sans-titre" }

  /** Télécharge, tague et range un titre. Renvoie l'adresse MediaStore du fichier. */
  fun download(context: Context, job: Job): Pair<String, String> {
    init(context)
    val (video, _) = pick(job) ?: throw IllegalStateException("Aucune vidéo YouTube fiable trouvée")
    val work = File(context.cacheDir, "jukebox").apply { mkdirs() }
    val stem = File(work, job.id)
    work.listFiles()?.filter { it.name.startsWith(job.id) }?.forEach { it.delete() }

    val request = YoutubeDLRequest("https://www.youtube.com/watch?v=${video.id}")
      .addOption("-f", "bestaudio/best")
      .addOption("-x")
      .addOption("--audio-format", "mp3")
      .addOption("--audio-quality", "320K")
      .addOption("--no-playlist")
      .addOption("--no-mtime")
      .addOption("--no-warnings")
      .addOption("-o", stem.absolutePath + ".%(ext)s")
    YoutubeDL.getInstance().execute(request, processId = job.id, redirectErrorStream = false, callback = null)

    val raw = File(work, job.id + ".mp3")
    if (!raw.exists()) throw IllegalStateException("Fichier mp3 introuvable après téléchargement")

    // Tags ID3 depuis Deezer : c'est ce que Samsung Music affiche (titre, artiste, pochette).
    val tagged = File(work, job.id + ".tagged.mp3")
    val mp3 = Mp3File(raw)
    if (mp3.hasId3v1Tag()) mp3.removeId3v1Tag()
    if (mp3.hasCustomTag()) mp3.removeCustomTag()
    val tag = ID3v24Tag()
    tag.title = job.title
    tag.artist = job.artist
    tag.albumArtist = job.artist
    if (job.album.isNotEmpty()) tag.album = job.album
    if (job.year.isNotEmpty()) tag.year = job.year
    if (job.trackNumber > 0) tag.track = job.trackNumber.toString()
    tag.comment = "JukeBox"
    if (job.coverUrl.isNotEmpty()) fetch(job.coverUrl)?.let { tag.setAlbumImage(it, "image/jpeg") }
    mp3.id3v2Tag = tag
    mp3.save(tagged.absolutePath)
    raw.delete()

    val uri = insert(context, tagged, "${safeName(job.artist)} - ${safeName(job.title)}.mp3")
    tagged.delete()
    return uri.toString() to video.id
  }

  private fun insert(context: Context, file: File, name: String): Uri {
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Audio.Media.DISPLAY_NAME, name)
      put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg")
      put(MediaStore.Audio.Media.RELATIVE_PATH, DISCOVERIES)
      put(MediaStore.Audio.Media.IS_MUSIC, 1)
      put(MediaStore.Audio.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Impossible de créer le fichier dans la musique")
    try {
      resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
        ?: throw IllegalStateException("Écriture impossible")
      resolver.update(uri, ContentValues().apply { put(MediaStore.Audio.Media.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    return uri
  }

  fun appendResult(context: Context, line: JSONObject) {
    synchronized(lock) { File(context.filesDir, RESULTS).appendText(line.toString() + "\n") }
  }

  fun drainResults(context: Context): String {
    synchronized(lock) {
      val f = File(context.filesDir, RESULTS)
      if (!f.exists()) return ""
      val text = f.readText()
      f.delete()
      return text
    }
  }
}
