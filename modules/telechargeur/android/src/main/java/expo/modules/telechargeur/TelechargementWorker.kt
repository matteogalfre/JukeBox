package expo.modules.telechargeur

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.yausername.youtubedl_android.YoutubeDL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Un titre gardé au tri = une tâche WorkManager. Android la lance quand la contrainte réseau
 * est remplie (Wi-Fi) et la relance plus tard en cas d'échec, même appli fermée.
 * L'étape en cours est publiée (setProgress) pour que l'appli affiche où ça en est.
 */
class TelechargementWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private suspend fun step(name: String) = setProgress(workDataOf(KEY_STEP to name))

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val json = inputData.getString(KEY_JOB) ?: return@withContext Result.failure()
    val job = Moteur.Job.parse(json)
    try {
      step("prepare")
      Moteur.init(applicationContext)
      updateEngineIfOld()
      step("download")
      val (uri, videoId) = Moteur.download(applicationContext, job)
      Moteur.appendResult(applicationContext, JSONObject()
        .put("id", job.id).put("ok", true).put("uri", uri).put("videoId", videoId)
        .put("at", System.currentTimeMillis()))
      Result.success()
    } catch (e: Exception) {
      val message = (e.message ?: e.javaClass.simpleName).take(300)
      // Pas de vidéo fiable : inutile de réessayer. Le reste (réseau, YouTube) : 3 essais.
      val final = message.startsWith("Aucune vidéo") || runAttemptCount >= 2
      Moteur.appendResult(applicationContext, JSONObject()
        .put("id", job.id).put("ok", false).put("final", final).put("error", message)
        .put("at", System.currentTimeMillis()))
      if (final) Result.failure() else Result.retry()
    }
  }

  /** yt-dlp intégré à l'APK vieillit vite face à YouTube : mise à jour tous les 3 jours. */
  private fun updateEngineIfOld() {
    val prefs = applicationContext.getSharedPreferences("jukebox_moteur", Context.MODE_PRIVATE)
    val last = prefs.getLong("updated_at", 0)
    if (System.currentTimeMillis() - last < 3L * 24 * 3600 * 1000) return
    try {
      YoutubeDL.getInstance().updateYoutubeDL(applicationContext, YoutubeDL.UpdateChannel.STABLE)
      prefs.edit().putLong("updated_at", System.currentTimeMillis()).apply()
    } catch (_: Exception) {
      // Pas grave : on tente avec la version actuelle.
    }
  }

  companion object {
    const val KEY_JOB = "job"
    const val KEY_STEP = "step"
  }
}
