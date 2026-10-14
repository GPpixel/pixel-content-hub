# The WebView calls these by name (window.STManager.*): keep them through R8.
-keepclassmembers class com.screentinker.manager.ManagerBridge {
    @android.webkit.JavascriptInterface <methods>;
}
