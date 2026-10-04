package tr.com.masaoyunlari.oyun;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Masa Oyunları — tek ekranlı, tam ekran WebView uygulaması.
 *
 * NEDEN TWA DEĞİL?
 * TakasVarmi projesinde önce TWA (Trusted Web Activity) denendi; Google Play
 * incelemesi onu "gerçek bir uygulama değil, tarayıcı sekmesi" diyerek
 * reddetti. Bu yüzden Masa Oyunları en baştan native bir WebView uygulaması
 * olarak kuruldu: androidbrowserhelper, Chrome Custom Tabs ya da TWA
 * başlatıcısı hiç kullanılmıyor.
 *
 * OYUN SİTESİNE ÖZGÜ KARARLAR (TakasVarmi'den AYRILDIĞI yerler):
 *  • Aşağı çekip yenileme YOK. Masada yanlışlıkla yenilemek maçı koparır;
 *    site de (js/webview.js) bu jesti zaten kapatıyor.
 *  • Kullanıcı ajanı dizisindeki "; wv" imzası KORUNUR. TakasVarmi onu
 *    Google girişi için siliyordu; burada Google girişi yok ve sitenin
 *    uygulama katmanı ortamı o imzadan tanıyor. Ayrıca kendi imzamızı
 *    (MasaOyunlariApp/<sürüm>) ekliyoruz ki tanıma imzadan bağımsız olsun.
 *  • Ekran oyun sırasında sönmez (site wakeLock istiyor; WebView'de o API
 *    yoksa native bayrak devreye girer).
 *  • Dosya seçici / açılır pencere köprüsü YOK: oyun sitesi dosya yüklemiyor.
 */
public class MainActivity extends AppCompatActivity {

    private String hostName;
    private String hostNameAlt;
    private String homeUrl;

    private WebView webView;
    private View splashView;
    private View offlineView;

    private boolean loadFailed = false;
    /** İki kez geri = çık. Sitenin kendi geri yönetimi bittiğinde devreye girer. */
    private long sonGeriZamani = 0L;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        setupEdgeToEdge();

        hostName = getString(R.string.hostName);
        hostNameAlt = getString(R.string.hostNameAlt);
        homeUrl = getString(R.string.launchUrl);

        webView = findViewById(R.id.webview);
        splashView = findViewById(R.id.splashView);
        offlineView = findViewById(R.id.offlineView);
        Button retryButton = findViewById(R.id.retryButton);

        setupWebView(webView);
        webView.addJavascriptInterface(new WebAppBridge(), "MasaOyunlariApp");

        retryButton.setOnClickListener(v -> {
            showLoading();
            webView.loadUrl(homeUrl);
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                /* Sitenin kendi geri yönetimi (js/webview.js) ekranlar arasında
                   gezinmek için history'ye kayıt bırakıyor; o kayıtlar bitene
                   kadar geri tuşu sayfaya aittir. Ancak oradan sonra uygulamayı
                   ANINDA kapatmak kötü: oyuncu masadayken tek dokunuşla oyundan
                   düşerdi. Bu yüzden ikinci bir onay isteniyor. */
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
                long simdi = System.currentTimeMillis();
                if (simdi - sonGeriZamani < 2200) {
                    finish();
                } else {
                    sonGeriZamani = simdi;
                    Toast.makeText(MainActivity.this, R.string.exitHint, Toast.LENGTH_SHORT).show();
                }
            }
        });

        showLoading();
        if (savedInstanceState != null) {
            // Android, bellek baskısı altında Activity'i yok edip geri dönüşte
            // yeniden kurabiliyor; adres ve geçmiş geri yükleniyor.
            webView.restoreState(savedInstanceState);
        } else {
            loadInitialUrl(getIntent());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadInitialUrl(intent);
    }

    /** Uygulama bir masaoyunlari.com.tr bağlantısıyla açıldıysa o adrese git. */
    private void loadInitialUrl(Intent intent) {
        Uri hedef = (intent != null) ? intent.getData() : null;
        if (hedef != null && bizimSitemizMi(hedef.getHost())) {
            webView.loadUrl(hedef.toString());
        } else {
            webView.loadUrl(homeUrl);
        }
    }

    // ---------------------------------------------------------------
    // Kenardan kenara çizim (API 36'da zorunlu): içeriğe sistem
    // çubuklarının yüksekliği kadar dolgu veriyoruz ki tahta ya da üst
    // bar durum çubuğunun altında kalmasın.
    // ---------------------------------------------------------------
    private void setupEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View decorRoot = findViewById(R.id.decorRoot);
        View contentRoot = findViewById(R.id.contentRoot);
        ViewCompat.setOnApplyWindowInsetsListener(decorRoot, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            contentRoot.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView(WebView wv) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);     // oturum, ses tercihi, oda kimliği
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);  // oyun sesleri
        s.setSupportMultipleWindows(false);            // açılır pencere yok
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        /* Kullanıcı ajanına kendi imzamızı ekliyoruz. Sitedeki js/webview.js
           uygulama kipini bundan (ve "; wv" imzasından) tanıyor; imza
           silinirse uygulama kipi kapanır ve geri tuşu/ekran kilidi
           davranışları tarayıcı gibi olur. "; wv" KORUNUR. */
        String ua = s.getUserAgentString();
        if (ua != null && !ua.contains("MasaOyunlariApp/")) {
            s.setUserAgentString(ua + " MasaOyunlariApp/" + BuildConfig.VERSION_NAME);
        }

        wv.setBackgroundColor(Color.parseColor("#0A0A1A"));
        // Oyun tahtasında kaydırma çubuğu/taşma parıltısı istemiyoruz.
        wv.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        wv.setVerticalScrollBarEnabled(false);
        wv.setHorizontalScrollBarEnabled(false);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(wv, true);

        wv.setWebViewClient(new SiteWebViewClient());
    }

    // ---------------------------------------------------------------
    // Navigasyon: kendi sitemiz WebView içinde kalır; dış bağlantılar
    // (e-posta, WhatsApp, başka siteler) telefonun kendi uygulamasında açılır.
    // ---------------------------------------------------------------
    private boolean bizimSitemizMi(String host) {
        if (host == null) return false;
        return host.equals(hostName) || host.equals(hostNameAlt)
                || host.endsWith("." + hostNameAlt);
    }

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme();
        boolean http = "http".equals(scheme) || "https".equals(scheme);
        if (http && bizimSitemizMi(uri.getHost())) return false;   // içeride kalsın
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Bu bağlantıyı açabilecek uygulama telefonda yok — sessizce yut.
        }
        return true;
    }

    /** Oyun sırasında ekran sönmesin. Site wakeLock isteyemezse bu devreye girer. */
    private void ekraniAcikTut(final boolean acik) {
        runOnUiThread(() -> {
            if (acik) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    /** Sayfanın çağırabildiği küçük köprü. Bilerek dar tutuldu. */
    private class WebAppBridge {
        /** Masaya oturulduğunda true, lobiye dönüldüğünde false. */
        @JavascriptInterface
        public void setKeepScreenOn(boolean acik) { ekraniAcikTut(acik); }

        /** Uygulama kipini JS tarafında kesin olarak doğrulamak için. */
        @JavascriptInterface
        public String appVersion() { return BuildConfig.VERSION_NAME; }
    }

    private class SiteWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
            loadFailed = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            if (!loadFailed) showContent();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            // YALNIZ ana belge hatası çevrimdışı ekranını açar. Tek bir ikon ya
            // da ses dosyası düşerse oyun durmamalı.
            if (request.isForMainFrame()) { loadFailed = true; showOffline(); }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            super.onReceivedError(view, errorCode, description, failingUrl);
            loadFailed = true;
            showOffline();
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            super.onReceivedHttpError(view, request, errorResponse);
            if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                loadFailed = true;
                showOffline();
            }
        }
    }

    // ---------------------- ekran durumları ----------------------
    private void showLoading() {
        splashView.setVisibility(View.VISIBLE);
        offlineView.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
    }

    private void showContent() {
        splashView.setVisibility(View.GONE);
        offlineView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private void showOffline() {
        splashView.setVisibility(View.GONE);
        webView.setVisibility(View.INVISIBLE);
        offlineView.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Arka plandayken oyun sesleri ve zamanlayıcılar sussun.
        webView.onPause();
        webView.pauseTimers();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.resumeTimers();
    }

    @Override
    protected void onDestroy() {
        ViewGroup ebeveyn = (ViewGroup) webView.getParent();
        if (ebeveyn != null) ebeveyn.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
