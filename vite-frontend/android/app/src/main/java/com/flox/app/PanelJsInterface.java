package com.flox.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;

public class PanelJsInterface {

    private static final String PREFS_NAME = "flox_panel_prefs";
    private static final String KEY_ADDRESSES = "panel_addresses";
    private static final String KEY_CURRENT = "panel_current";

    private final Context context;
    private final Gson gson;

    public PanelJsInterface(Context context) {
        this.context = context;
        this.gson = new Gson();
    }

    @JavascriptInterface
    public void getPanelAddresses(String callback) {
        List<PanelAddress> addresses = loadAddresses();
        String currentName = getCurrentName();
        for (PanelAddress addr : addresses) {
            addr.inx = addr.name.equals(currentName);
        }
        String json = gson.toJson(addresses);
        executeCallback(callback, json);
    }

    @JavascriptInterface
    public void savePanelAddress(String name, String address) {
        List<PanelAddress> addresses = loadAddresses();
        boolean exists = false;
        for (PanelAddress addr : addresses) {
            if (addr.name.equals(name)) {
                addr.address = address;
                exists = true;
                break;
            }
        }
        if (!exists) {
            PanelAddress newAddr = new PanelAddress();
            newAddr.name = name;
            newAddr.address = address;
            if (addresses.isEmpty()) {
                newAddr.inx = true;
                saveCurrentName(name);
            }
            addresses.add(newAddr);
        }
        saveAddresses(addresses);
    }

    @JavascriptInterface
    public void setCurrentPanelAddress(String name) {
        saveCurrentName(name);
        List<PanelAddress> addresses = loadAddresses();
        for (PanelAddress addr : addresses) {
            addr.inx = addr.name.equals(name);
        }
        saveAddresses(addresses);
    }

    @JavascriptInterface
    public void deletePanelAddress(String name) {
        List<PanelAddress> addresses = loadAddresses();
        String currentName = getCurrentName();
        addresses.removeIf(addr -> addr.name.equals(name));
        if (name.equals(currentName)) {
            if (!addresses.isEmpty()) {
                addresses.get(0).inx = true;
                saveCurrentName(addresses.get(0).name);
            } else {
                saveCurrentName("");
            }
        }
        saveAddresses(addresses);
    }

    private List<PanelAddress> loadAddresses() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_ADDRESSES, "[]");
        Type type = new TypeToken<List<PanelAddress>>() {}.getType();
        List<PanelAddress> list = gson.fromJson(json, type);
        return list != null ? list : new ArrayList<>();
    }

    private void saveAddresses(List<PanelAddress> addresses) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_ADDRESSES, gson.toJson(addresses)).apply();
    }

    private String getCurrentName() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_CURRENT, "");
    }

    private void saveCurrentName(String name) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_CURRENT, name).apply();
    }

    private void executeCallback(String callback, String json) {
        if (callback != null && !callback.isEmpty()) {
            String script = "window." + callback + "(" + json + ")";
            android.webkit.WebView webView = findWebView();
            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(script, null));
            }
        }
    }

    private android.webkit.WebView findWebView() {
        if (context instanceof android.app.Activity) {
            android.webkit.WebView webView = ((android.app.Activity) context).findViewById(
                com.getcapacitor.R.id.webview
            );
            return webView;
        }
        return null;
    }

    private static class PanelAddress {
        String name;
        String address;
        boolean inx;

        PanelAddress() {}
    }
}
