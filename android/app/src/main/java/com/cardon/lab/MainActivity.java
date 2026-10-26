package com.cardon.lab;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * lab.ia: un WebView que se conecta al servidor de lab.ia.
 * Por defecto busca el servidor en este mismo teléfono (Termux, 127.0.0.1:8790);
 * también puede usar otro teléfono o equipo de la misma red Wi-Fi.
 */
public class MainActivity extends Activity {
    static final String LOCAL = "http://127.0.0.1:8790";
    static final int PUERTO = 8790;
    static final String CONEXION = "file:///android_asset/conexion.html";
    private static final int PERMISO_TERMUX = 7;
    private static final int PERMISOS_INICIO = 8;
    static final String TERMUX_PERMISO = "com.termux.permission.RUN_COMMAND";
    static final String CANAL = "respuestas";
    private boolean autoEncendido = false;
    private int idAviso = 100;

    private WebView web;
    private SharedPreferences prefs;
    private final ExecutorService hilos = Executors.newCachedThreadPool();

    @Override public void onCreate(Bundle estado) {
        super.onCreate(estado);
        prefs = getSharedPreferences("lab", MODE_PRIVATE);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return abrirFuera(request.getUrl().toString());
            }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return abrirFuera(url);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !request.getUrl().toString().startsWith("file:")) {
                    mostrarConexion("caido");
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                return dialogo(message, null, result, null, false);
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                return dialogo(message, null, result, null, true);
            }
            @Override public boolean onJsPrompt(WebView view, String url, String message, String def, JsPromptResult result) {
                return dialogo(message, def == null ? "" : def, result, result, true);
            }
        });
        web.addJavascriptInterface(new Puente(), "CardonApp");
        setContentView(web, new ViewGroup.LayoutParams(-1, -1));
        crearCanal();
        pedirPermisos();
        conectar();
    }

    /** Pide de una vez los permisos que faltan: usar Termux y (Android 13+) notificaciones. */
    void pedirPermisos() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> faltan = new ArrayList<>();
        if (checkSelfPermission(TERMUX_PERMISO) != PackageManager.PERMISSION_GRANTED && termuxInstalado()) faltan.add(TERMUX_PERMISO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            faltan.add("android.permission.POST_NOTIFICATIONS");
        }
        if (!faltan.isEmpty()) requestPermissions(faltan.toArray(new String[0]), PERMISOS_INICIO);
    }

    boolean tienePermiso(String p) {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    boolean termuxInstalado() {
        try { getPackageManager().getPackageInfo("com.termux", 0); return true; } catch (Exception e) { return false; }
    }

    void crearCanal() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel c = new NotificationChannel(CANAL, "Respuestas", NotificationManager.IMPORTANCE_DEFAULT);
        c.setDescription("Avisa cuando termina una respuesta, investigación o imagen");
        c.setLightColor(Color.RED);
        c.enableLights(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
    }

    void notificar(String titulo, String texto) {
        if (Build.VERSION.SDK_INT >= 33 && !tienePermiso("android.permission.POST_NOTIFICATIONS")) return;
        Intent abrir = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CANAL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.icono_notif)
            .setColor(Color.rgb(255, 45, 45))
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(new Notification.BigTextStyle().bigText(texto))
            .setContentIntent(pi)
            .setAutoCancel(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(idAviso++, b.build());
    }

    String servidor() { return prefs.getString("servidor", LOCAL); }

    /** Muestra la pantalla de conexión y prueba el servidor guardado; si responde, lo abre. */
    void conectar() {
        mostrarConexion("probando");
        final String url = servidor();
        hilos.execute(() -> {
            boolean ok = responde(url, 3000);
            runOnUiThread(() -> {
                if (ok) web.loadUrl(url + "/");
                else if (url.equals(LOCAL) && !autoEncendido && termuxInstalado() && tienePermiso(TERMUX_PERMISO)) {
                    // Primera vez en esta sesión: se enciende solo en Termux.
                    autoEncendido = true;
                    encenderEnTermux();
                } else js("estadoConexion('apagado')");
            });
        });
    }

    void mostrarConexion(String estado) {
        prefs.edit().putString("estado", estado).apply();
        web.loadUrl(CONEXION);
    }

    static boolean responde(String base, int ms) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/estado").openConnection();
            c.setConnectTimeout(ms);
            c.setReadTimeout(ms);
            int codigo = c.getResponseCode();
            c.disconnect();
            return codigo == 200;
        } catch (Exception e) {
            return false;
        }
    }

    void js(String codigo) {
        runOnUiThread(() -> web.evaluateJavascript(codigo, null));
    }

    /** Lo que no es del servidor (fuentes, artículos) se abre en el navegador. */
    private boolean abrirFuera(String url) {
        if (url == null) return true;
        if (url.startsWith("file:") || url.startsWith(servidor())) return false;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignorado) { }
        }
        return true;
    }

    @Override public void onBackPressed() {
        String actual = web.getUrl();
        if (actual != null && actual.startsWith("file:")) { super.onBackPressed(); return; }
        web.evaluateJavascript("window.cardonAtras ? window.cardonAtras() : false", valor -> {
            if (!"true".equals(valor)) moveTaskToBack(true);
        });
    }

    @Override protected void onResume() {
        super.onResume();
        // Al volver a la app, si el servidor se cayó se muestra la pantalla de conexión.
        String actual = web.getUrl();
        if (actual != null && !actual.startsWith("file:")) {
            final String url = servidor();
            hilos.execute(() -> { if (!responde(url, 2500)) runOnUiThread(() -> mostrarConexion("caido")); });
        }
    }

    @Override public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        if (codigo == PERMISOS_INICIO) {
            js("window.permisosCambiados && permisosCambiados()");
            // Si se acaba de conceder Termux y el servidor local está apagado, se enciende.
            if (tienePermiso(TERMUX_PERMISO) && servidor().equals(LOCAL) && !autoEncendido) {
                hilos.execute(() -> { if (!responde(LOCAL, 1500)) runOnUiThread(() -> { autoEncendido = true; encenderEnTermux(); }); });
            }
            return;
        }
        if (codigo == PERMISO_TERMUX && resultados.length > 0 && resultados[0] == PackageManager.PERMISSION_GRANTED) {
            encenderEnTermux();
        } else if (codigo == PERMISO_TERMUX) {
            js("aviso('Sin permiso para usar Termux. Actívalo en Ajustes de Android → Apps → lab.ia → Permisos.')");
        }
    }

    /** Pide a Termux que ejecute `lab iniciar` en segundo plano y espera a que responda. */
    void encenderEnTermux() {
        if (!tienePermiso(TERMUX_PERMISO)) {
            requestPermissions(new String[]{TERMUX_PERMISO}, PERMISO_TERMUX);
            return;
        }
        if (ejecutarLab("iniciar")) {
            js("window.estadoConexion && estadoConexion('encendiendo')");
            esperarServidor(LOCAL, 90);
        }
    }

    /** Ejecuta `lab <accion>` en Termux, en segundo plano (iniciar, detener, reiniciar). */
    boolean ejecutarLab(String accion) {
        if (!tienePermiso(TERMUX_PERMISO)) {
            requestPermissions(new String[]{TERMUX_PERMISO}, PERMISO_TERMUX);
            return false;
        }
        try {
            Intent i = new Intent();
            i.setClassName("com.termux", "com.termux.app.RunCommandService");
            i.setAction("com.termux.RUN_COMMAND");
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/lab");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{accion});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
            return true;
        } catch (Exception e) {
            String m = e.getMessage() == null ? e.toString() : e.getMessage();
            if (m.contains("allow-external-apps")) m = "En Termux falta allow-external-apps=true en ~/.termux/termux.properties";
            js("window.aviso && aviso(" + JSONObject.quote("No se pudo hablar con Termux: " + m) + ")");
            return false;
        }
    }

    void esperarServidor(String url, int segundos) {
        hilos.execute(() -> {
            for (int i = 0; i < segundos; i++) {
                if (responde(url, 1500)) {
                    prefs.edit().putString("servidor", url).apply();
                    runOnUiThread(() -> web.loadUrl(url + "/"));
                    return;
                }
                try { Thread.sleep(1000); } catch (InterruptedException e) { return; }
            }
            js("estadoConexion('apagado')");
        });
    }

    /** Busca servidores de lab.ia en la red local (misma subred /24, puerto 8790). */
    void buscarEnRed() {
        hilos.execute(() -> {
            List<String> propias = new ArrayList<>();
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                        if (a instanceof Inet4Address && a.isSiteLocalAddress()) propias.add(a.getHostAddress());
                    }
                }
            } catch (Exception ignorado) { }
            List<String> encontrados = Collections.synchronizedList(new ArrayList<>());
            if (responde(LOCAL, 1500)) encontrados.add(LOCAL);
            ExecutorService pool = Executors.newFixedThreadPool(48);
            for (String ip : propias) {
                String prefijo = ip.substring(0, ip.lastIndexOf('.') + 1);
                for (int h = 1; h < 255; h++) {
                    final String host = prefijo + h;
                    pool.execute(() -> {
                        try (Socket so = new Socket()) {
                            so.connect(new InetSocketAddress(host, PUERTO), 350);
                            String url = "http://" + host + ":" + PUERTO;
                            if (responde(url, 1500)) encontrados.add(url);
                        } catch (Exception ignorado) { }
                    });
                }
            }
            pool.shutdown();
            try { pool.awaitTermination(25, TimeUnit.SECONDS); } catch (InterruptedException ignorado) { }
            JSONArray lista = new JSONArray();
            for (String u : encontrados) lista.put(u);
            js("encontrados(" + lista + "," + new JSONArray(propias) + ")");
        });
    }

    private boolean dialogo(String mensaje, String entrada, JsResult result, JsPromptResult prompt, boolean cancelable) {
        if (isFinishing()) { result.cancel(); return true; }
        try {
            final EditText campo = entrada == null ? null : new EditText(this);
            AlertDialog.Builder b = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert).setMessage(mensaje);
            if (campo != null) {
                campo.setText(entrada);
                campo.setSelectAllOnFocus(true);
                campo.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
                FrameLayout caja = new FrameLayout(this);
                int pad = (int) (20 * getResources().getDisplayMetrics().density);
                caja.setPadding(pad, 0, pad, 0);
                caja.addView(campo);
                b.setView(caja);
            }
            b.setPositiveButton(android.R.string.ok, (d, w) -> {
                if (campo != null && prompt != null) prompt.confirm(campo.getText().toString()); else result.confirm();
            });
            if (cancelable) b.setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel());
            b.setOnCancelListener(d -> result.cancel());
            b.show();
        } catch (Exception e) { result.cancel(); }
        return true;
    }

    /** Funciones que la interfaz web puede llamar como window.CardonApp.*. */
    class Puente {
        @JavascriptInterface public String servidor() { return MainActivity.this.servidor(); }
        @JavascriptInterface public String estado() { return prefs.getString("estado", "probando"); }
        @JavascriptInterface public String version() { return "1.2.0"; }

        @JavascriptInterface public void notificar(String titulo, String texto) { MainActivity.this.notificar(titulo, texto); }
        @JavascriptInterface public String permisos() {
            try {
                JSONObject o = new JSONObject();
                o.put("termuxInstalado", termuxInstalado());
                o.put("termux", tienePermiso(TERMUX_PERMISO));
                o.put("notificaciones", Build.VERSION.SDK_INT < 33 || tienePermiso("android.permission.POST_NOTIFICATIONS"));
                return o.toString();
            } catch (Exception e) { return "{}"; }
        }
        @JavascriptInterface public void pedirPermisos() { runOnUiThread(MainActivity.this::pedirPermisos); }
        @JavascriptInterface public void ajustesApp() {
            runOnUiThread(() -> startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        }
        /** iniciar · reiniciar · detener. Tras reiniciar se espera al servidor y se recarga. */
        @JavascriptInterface public void termux(String accion) {
            if (!accion.matches("iniciar|reiniciar|detener")) return;
            runOnUiThread(() -> {
                if (!ejecutarLab(accion)) return;
                if (accion.equals("detener")) mostrarConexion("apagado");
                else { mostrarConexion("encendiendo"); esperarServidor(LOCAL, 90); }
            });
        }

        @JavascriptInterface public void conectarA(String url) {
            String limpio = url.trim().replaceAll("/+$", "");
            // Una nube (https://…workers.dev) va tal cual; una IP de la red local lleva el puerto 8790.
            boolean pareceNube = limpio.startsWith("https://") || limpio.matches("^[\\w.-]+\\.[a-z]{2,}$") && !limpio.matches("^[\\d.]+$");
            if (!limpio.startsWith("http")) limpio = (pareceNube ? "https://" : "http://") + limpio;
            if (limpio.startsWith("http://") && !limpio.matches("^http://[^/]+:\\d+$")) limpio = limpio + ":" + PUERTO;
            prefs.edit().putString("servidor", limpio).apply();
            runOnUiThread(MainActivity.this::conectar);
        }
        @JavascriptInterface public void reintentar() { runOnUiThread(MainActivity.this::conectar); }
        @JavascriptInterface public void cambiarServidor() { runOnUiThread(() -> mostrarConexion("elegir")); }
        @JavascriptInterface public void encenderTermux() { runOnUiThread(MainActivity.this::encenderEnTermux); }
        @JavascriptInterface public void buscarEnRed() { MainActivity.this.buscarEnRed(); }

        @JavascriptInterface public boolean termuxInstalado() { return MainActivity.this.termuxInstalado(); }
        @JavascriptInterface public void abrirTermux() {
            Intent i = getPackageManager().getLaunchIntentForPackage("com.termux");
            if (i != null) startActivity(i);
        }

        @JavascriptInterface public void copiar(String texto) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("lab.ia", texto));
        }

        /** Guarda una imagen del servidor en Imágenes/lab.ia. */
        @JavascriptInterface public void guardarImagen(String url) {
            if (url == null || !url.startsWith(MainActivity.this.servidor() + "/media/")) return;
            runOnUiThread(() -> {
                try {
                    String nombre = url.substring(url.lastIndexOf('/') + 1);
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    String galleta = CookieManager.getInstance().getCookie(url);
                    if (galleta != null) r.addRequestHeader("Cookie", galleta);
                    r.setTitle("lab.ia · " + nombre);
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_PICTURES, "lab.ia/" + nombre);
                    ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                    Toast.makeText(MainActivity.this, "Guardando en Imágenes/lab.ia", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No se pudo guardar: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
