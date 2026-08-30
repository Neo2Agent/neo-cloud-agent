package agent.neo.pcm

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.concurrent.thread

class NeoPcmRecorderModule : Module() {
  private var recorder: AudioRecord? = null
  private var running = false

  override fun definition() = ModuleDefinition {
    Name("NeoPcmRecorder")
    Events("audio")

    AsyncFunction("start") {
      startRecorder()
    }

    AsyncFunction("stop") {
      stopRecorder()
    }
  }

  private fun startRecorder() {
    if (running) return
    val sampleRate = 16000
    val channel = AudioFormat.CHANNEL_IN_MONO
    val encoding = AudioFormat.ENCODING_PCM_16BIT
    val minBuf = AudioRecord.getMinBufferSize(sampleRate, channel, encoding)
    val recorder = AudioRecord(
      MediaRecorder.AudioSource.MIC,
      sampleRate,
      channel,
      encoding,
      minBuf * 2,
    )
    this.recorder = recorder
    running = true
    recorder.startRecording()
    thread(name = "neo-pcm") {
      val frame = ByteArray(1280)
      while (running) {
        val read = recorder.read(frame, 0, frame.size)
        if (read > 0) {
          val encoded = Base64.encodeToString(frame.copyOf(read), Base64.NO_WRAP)
          sendEvent("audio", mapOf("pcm" to encoded))
        }
      }
    }
  }

  private fun stopRecorder() {
    running = false
    try {
      recorder?.stop()
    } catch (_: Exception) {
    }
    recorder?.release()
    recorder = null
  }
}
