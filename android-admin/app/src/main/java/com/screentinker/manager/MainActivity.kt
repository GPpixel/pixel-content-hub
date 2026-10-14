package com.screentinker.manager

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import kotlin.concurrent.thread

/**
 * The server's Simple view (<origin>/app#/) in a WebView, plus what a phone adds:
 *  - the file picker opens Android's photo picker (no storage permission needed);
 *  - "Share to ScreenTinker Manager" from the Gallery uploads and opens "Which screens?";
 *  - pages of other sites (Stripe, GitHub, guides elsewhere) open in the browser, never in here;
 *  - Back walks the dashboard's own history before leaving the app.
 * The dashboard knows it is in here from the user agent ("ScreenTinkerManager/<v>") and stays in the
 * Simple view; Advanced, Admin and Settings open in the browser through window.STManager.
 */
class MainActivity : ComponentActivity() {

    private lateinit var origin: String
    private lateinit var web: WebView
    private lateinit var overlay: TextView
    private lateinit var offline: LinearLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingShare: List<Uri> = emptyList()
    private var pageReady = false

    private val pickMany = registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(MAX_FILES)) { uris ->
        deliver(uris)
    }
    private val pickOne = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        deliver(listOfNotNull(uri))
    }
    private val pickAny = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        deliver(uris)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val saved = ServerStore.get(this)
        if (saved == null) {
            // First run: choose the server, carrying any share that launched us along.
            startActivity(Intent(this, ServerActivity::class.java).putExtra(ServerActivity.EXTRA_FORWARD, intent))
            finish()
            return
        }
        origin = saved
        buildViews()
        setUpWebView()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null && !intent.getBooleanExtra(EXTRA_RELOAD, false)) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl("$origin/app#/")
        }
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_RELOAD, false)) {
            ServerStore.get(this)?.let { origin = it }
            pageReady = false
            web.loadUrl("$origin/app#/")
        }
        handleShareIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // Every server was removed from "Your servers": back to first run.
        if (::origin.isInitialized && ServerStore.get(this) == null) {
            startActivity(Intent(this, ServerActivity::class.java))
            finish()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    private fun buildViews() {
        val root = FrameLayout(this).apply { setBackgroundColor(ContextCompat.getColor(context, R.color.bg)) }
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        overlay = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 15f
            setPadding(48, 32, 48, 32)
            setBackgroundColor(0xE61E293B.toInt())
            gravity = Gravity.CENTER
            visibility = View.GONE
        }
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        offline = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setBackgroundColor(ContextCompat.getColor(context, R.color.bg))
            visibility = View.GONE
            addView(TextView(context).apply {
                text = getString(R.string.offline)
                setTextColor(ContextCompat.getColor(context, R.color.text))
                textSize = 16f
                gravity = Gravity.CENTER
            })
            addView(Button(context).apply {
                text = getString(R.string.retry)
                isAllCaps = false
                setOnClickListener { offline.visibility = View.GONE; web.reload() }
            })
        }
        root.addView(offline, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // Android 15+ draws edge to edge: keep the dashboard clear of the status and navigation bars.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        // Debug builds only: lets Chrome DevTools (and the emulator tests) inspect the WebView.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString ScreenTinkerManager/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(ManagerBridge(this, origin), "STManager")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (ServerStore.sameOrigin(origin, url)) return false
                if (url.scheme == "http" || url.scheme == "https") ManagerBridge.openInCustomTab(this@MainActivity, url)
                else try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (e: Exception) { /* nothing handles it */ }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                maybeUploadShare()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) offline.visibility = View.VISIBLE
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val accept = params.acceptTypes.joinToString(",").lowercase()
                val visual = accept.isBlank() || accept.contains("image") || accept.contains("video")
                val multiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
                try {
                    when {
                        visual && multiple -> pickMany.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        visual -> pickOne.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        else -> pickAny.launch("*/*")
                    }
                } catch (e: Exception) {
                    fileCallback = null
                    return false
                }
                return true
            }
        }
    }

    private fun deliver(uris: List<Uri>) {
        fileCallback?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        fileCallback = null
    }

    // ---- Share from the Gallery -------------------------------------------------------------------

    private fun handleShareIntent(intent: Intent?) {
        intent ?: return
        val uris = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java) ?: emptyList()
            else -> emptyList()
        }
        if (uris.isEmpty()) return
        Log.i(TAG, "share: ${uris.size} item(s)")
        pendingShare = uris.take(MAX_FILES)
        // Consume it, so a rotation or a later onNewIntent does not upload the same photos twice.
        intent.action = Intent.ACTION_MAIN
        maybeUploadShare()
    }

    private fun maybeUploadShare() {
        if (!pageReady || pendingShare.isEmpty()) return
        val uris = pendingShare
        pendingShare = emptyList()
        // The dashboard keeps its session token in localStorage; the upload uses the same session.
        web.evaluateJavascript("localStorage.getItem('token')") { raw ->
            val token = try { if (raw == null || raw == "null") null else JSONArray("[$raw]").getString(0) } catch (e: Exception) { null }
            if (token.isNullOrBlank()) {
                Log.w(TAG, "share: not signed in")
                Toast.makeText(this, R.string.share_sign_in_first, Toast.LENGTH_LONG).show()
                return@evaluateJavascript
            }
            overlay.text = getString(R.string.uploading, uris.size)
            overlay.visibility = View.VISIBLE
            thread {
                val result = try {
                    Result.success(ShareUploader.upload(contentResolver, origin, token, uris))
                } catch (e: Exception) {
                    Result.failure(e)
                }
                runOnUiThread {
                    overlay.visibility = View.GONE
                    result.onSuccess { ids ->
                        if (ids.isNotEmpty()) web.loadUrl("$origin/app#/simple/upload?ids=${ids.joinToString(",")}")
                    }.onFailure { e ->
                        Log.w(TAG, "share: upload failed", e)
                        Toast.makeText(this, getString(R.string.share_failed, e.message ?: ""), Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    companion object {
        const val EXTRA_RELOAD = "reload"
        const val MAX_FILES = 50
        private const val TAG = "STManager"
    }
}
