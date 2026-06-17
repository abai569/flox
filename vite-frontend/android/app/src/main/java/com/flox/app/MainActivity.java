package com.flox.app;

import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onStart() {
        super.onStart();
        Bridge bridge = getBridge();
        if (bridge != null) {
            WebView webView = bridge.getWebView();
            if (webView != null) {
                webView.getSettings().setJavaScriptEnabled(true);
                webView.addJavascriptInterface(
                    new PanelJsInterface(this),
                    "JsInterface"
                );
            }
        }
    }
}
