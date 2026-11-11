-keepattributes JavascriptInterface
-keepclassmembers class at.hafner.gruenraum.bridge.PixelNativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class at.hafner.gruenraum.bridge.** { *; }
