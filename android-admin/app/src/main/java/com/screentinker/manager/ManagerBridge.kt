package com.screentinker.manager

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import androidx.browser.customtabs.CustomTabsIntent

/**
 * window.STManager, for the dashboard's Simple view (frontend/js/utils.js inManagerApp/openOutsideApp).
 * Deliberately tiny: it can open a page OF THIS SERVER in the browser, start "Change server", and say
 * its version. Nothing reads data, so a page that somehow got into the WebView gains nothing here.
 */
class ManagerBridge(private val activity: Activity, private val origin: String) {

    @JavascriptInterface
    fun openInBrowser(url: String) {
        val uri = Uri.parse(url)
        if (!ServerStore.sameOrigin(origin, uri)) return
        activity.runOnUiThread { openInCustomTab(activity, uri) }
    }

    @JavascriptInterface
    fun changeServer() {
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, ServerActivity::class.java))
        }
    }

    /** Android's share sheet (WhatsApp, Messages, email...) for a short text such as an invite link. */
    @JavascriptInterface
    fun shareText(text: String) {
        if (text.length > 2000) return
        activity.runOnUiThread {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            activity.startActivity(Intent.createChooser(send, null))
        }
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    companion object {
        fun openInCustomTab(activity: Activity, uri: Uri) {
            try {
                CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(activity, uri)
            } catch (e: Exception) {
                activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
        }
    }
}
