package com.medconsults.dermoffline

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Locale

// The page believes it lives at https://appassets.androidplatform.net/ (so fetch(), root-relative URLs and
// the page's own offline-shim.js behave as on a real site). Every request for that address is answered from
// assets/derm/; nothing else is ever loaded, and the app has no INTERNET permission.
private const val HOST = "appassets.androidplatform.net"
private const val START = "dermatology-differential-engine.html"

class MainActivity : Activity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true) // chrome://inspect can open this page in debug builds
        }
        web = WebView(this)
        web.settings.javaScriptEnabled = true // the engine is JavaScript
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = AssetClient()
        setContentView(web)
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
        } else {
            web.loadUrl("https://$HOST/$START")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    private inner class AssetClient : WebViewClient() {

        // Serves https://appassets.androidplatform.net/<path> from assets/derm/<path>; "/" and "dir/" mean index.html.
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val uri = request.url
            if (uri.host != HOST) return reply(403, "Forbidden") // nothing leaves the app
            var path = uri.path ?: "/"
            if (path.endsWith("/")) path += "index.html"
            return try {
                WebResourceResponse(mimeOf(path), charsetOf(path), assets.open("derm$path"))
            } catch (e: IOException) {
                reply(404, "Not Found")
            }
        }

        // Links that point elsewhere (a citation, a mailto:) open in the phone's own browser or mail app.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == HOST) return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
            } catch (e: Exception) {
                // no app on the phone can open it
            }
            return true
        }
    }

    private fun reply(status: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", status, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun mimeOf(path: String): String {
        val name = path.substringAfterLast('/')
        return when (name.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json", "webmanifest" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }

    private fun charsetOf(path: String): String? {
        val mime = mimeOf(path)
        return if (mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml") "utf-8" else null
    }
}
