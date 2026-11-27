package expo.modules.telechargeur

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.yausername.youtubedl_android.YoutubeDL
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class TelechargeurModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Contexte Android indisponible")

  private val tag = "jukebox-dl"

  override fun definition() = ModuleDefinition {
    Name("Telechargeur")

    // Met un titre en file. wifiOnly : Android attend un réseau non facturé à l'usage.
    Function("enqueue") { jobJson: String, wifiOnly: Boolean ->
      val id = JSONObject(jobJson).getString("id")
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .build()
      val request = OneTimeWorkRequestBuilder<TelechargementWorker>()
        .setInputData(workDataOf(TelechargementWorker.KEY_JOB to jobJson))
        .setConstraints(constraints)
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
        .addTag(tag)
        .addTag("id:$id")
        .build()
      // REPLACE : « Réessayer » relance tout de suite, même si un ancien essai attendait.
      WorkManager.getInstance(context).enqueueUniqueWork("dl-$id", ExistingWorkPolicy.REPLACE, request)
    }

    // Titres encore en attente ou en cours.
    AsyncFunction("pendingCount") {
      WorkManager.getInstance(context).getWorkInfosByTag(tag).get()
        .count { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.BLOCKED }
    }

    // Où en est chaque téléchargement : en attente (réseau), en cours (étape), nouvel essai…
    AsyncFunction("status") {
      WorkManager.getInstance(context).getWorkInfosByTag(tag).get().mapNotNull { info ->
        val id = info.tags.firstOrNull { it.startsWith("id:") }?.removePrefix("id:") ?: return@mapNotNull null
        mapOf(
          "id" to id,
          "state" to info.state.name,
          "attempts" to info.runAttemptCount,
          "step" to info.progress.getString(TelechargementWorker.KEY_STEP),
          "stopReason" to info.stopReason,
        )
      }
    }

    // Le réseau actuel compte-t-il comme Wi-Fi pour Android (non facturé à l'usage) ?
    Function("networkIsUnmetered") {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
      val caps = cm.getNetworkCapabilities(cm.activeNetwork)
      caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    }

    // Résultats terminés depuis le dernier appel (lignes JSON).
    Function("drainResults") {
      Moteur.drainResults(context)
    }

    AsyncFunction("deleteMedia") { uri: String ->
      try {
        context.contentResolver.delete(Uri.parse(uri), null, null) > 0
      } catch (_: Exception) {
        false
      }
    }

    // Déplace un fichier créé par JukeBox (ex. Découvertes → bibliothèque).
    AsyncFunction("moveMedia") { uri: String, relativePath: String ->
      try {
        val values = ContentValues().apply { put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath) }
        context.contentResolver.update(Uri.parse(uri), values, null, null) > 0
      } catch (_: Exception) {
        false
      }
    }

    // Met à jour yt-dlp (correctifs quand YouTube change). Renvoie la version installée.
    AsyncFunction("updateEngine") {
      Moteur.init(context)
      val status = YoutubeDL.getInstance().updateYoutubeDL(context, YoutubeDL.UpdateChannel.STABLE)
      mapOf("status" to (status?.name ?: "UNKNOWN"), "version" to YoutubeDL.getInstance().versionName(context))
    }

    AsyncFunction("engineVersion") {
      Moteur.init(context)
      YoutubeDL.getInstance().versionName(context)
    }
  }
}
