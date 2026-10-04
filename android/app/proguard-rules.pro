# Küçültme kapalı (bkz. app/build.gradle); yine de WebView köprüsündeki
# @JavascriptInterface işaretli yöntemler hiçbir koşulda yeniden
# adlandırılmamalı — adları JavaScript tarafından çağrılıyor.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
