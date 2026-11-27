package expo.modules.telechargeur

import java.text.Normalizer

/**
 * Choisit la bonne vidéo YouTube pour un titre Deezer.
 * La durée est le signal le plus fiable, les chaînes
 * « Artiste - Topic » sont l'audio officiel, et on pénalise live, remix, sped up, etc.
 */
object Recherche {
  private val noise = Regex(
    "\\b(official|officiel|video|clip|audio|hd|hq|4k|lyrics?|lyric|visuali[sz]er|mv|full|song|music)\\b",
    RegexOption.IGNORE_CASE,
  )

  private val penalties = mapOf(
    "live" to 0.45, "concert" to 0.45, "en direct" to 0.45, "cover" to 0.50, "karaoke" to 0.65,
    "instrumental" to 0.50, "sped up" to 0.40, "spedup" to 0.40, "speed up" to 0.40,
    "slowed" to 0.40, "reverb" to 0.30, "nightcore" to 0.65, "8d" to 0.40,
    "remix" to 0.35, "mashup" to 0.50, "reaction" to 0.70, "tutorial" to 0.70,
    "cours" to 0.60, "session" to 0.25, "acoustic" to 0.25, "unplugged" to 0.35,
    "mix" to 0.20, "compilation" to 0.60, "playlist" to 0.60,
  )

  fun normalize(text: String?): String {
    var t = Normalizer.normalize(text ?: "", Normalizer.Form.NFKD)
      .replace(Regex("\\p{M}+"), "")
      .lowercase()
    t = t.replace(Regex("\\(.*?\\)|\\[.*?\\]"), " ")
    t = noise.replace(t, " ")
    t = t.replace(Regex("[^a-z0-9]+"), " ")
    return t.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")
  }

  /** Similarité 0..1 (distance de Levenshtein normalisée). */
  fun ratio(a: String, b: String): Double {
    if (a.isEmpty() && b.isEmpty()) return 1.0
    val prev = IntArray(b.length + 1) { it }
    val cur = IntArray(b.length + 1)
    for (i in 1..a.length) {
      cur[0] = i
      for (j in 1..b.length) {
        val cost = if (a[i - 1] == b[j - 1]) 0 else 1
        cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      }
      System.arraycopy(cur, 0, prev, 0, cur.size)
    }
    return 1.0 - prev[b.length].toDouble() / maxOf(a.length, b.length)
  }

  data class Candidat(val id: String, val title: String, val channel: String, val duration: Double)

  fun score(c: Candidat, artist: String, title: String, album: String, durationS: Double): Double {
    val target = normalize("$artist $title")
    var s = ratio(target, normalize(c.title))
    if (c.channel.trim().endsWith("- Topic")) s += 0.30
    else if (c.channel.lowercase().contains("vevo")) s += 0.15
    if (normalize(artist).isNotEmpty() && normalize(c.channel).contains(normalize(artist))) s += 0.10

    if (c.duration > 0 && durationS > 0) {
      val delta = Math.abs(c.duration - durationS)
      when {
        delta <= 2 -> s += 0.25
        delta <= 5 -> s += 0.15
        delta > 20 -> s -= 0.50 + minOf(delta / 120.0, 0.5)
      }
    } else {
      s -= 0.10
    }

    val known = normalize("$title $album")
    val lowered = c.title.lowercase()
    for ((word, malus) in penalties) {
      if (lowered.contains(word) && !known.contains(word)) s -= malus
    }
    return s
  }
}
