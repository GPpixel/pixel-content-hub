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
