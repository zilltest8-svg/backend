import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:math';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

import 'script_failure.dart';

@JS('JSON.stringify')
external JSString _stringify(JSAny? value);

/// Hand the bytes to the browser as a file download.
Future<String?> saveFile(Uint8List bytes, String filename, String mime) async {
  final blob = web.Blob([bytes.toJS].toJS, web.BlobPropertyBag(type: mime));
  final href = web.URL.createObjectURL(blob);
  final a = web.HTMLAnchorElement()
    ..href = href
    ..download = filename;
  web.document.body!.append(a);
  a.click();
  a.remove();
  web.URL.revokeObjectURL(href);
  return null;
}

/// Load a URL through a <script> tag and resolve with whatever it calls back.
/// Script tags are exempt from CORS, which makes this the only way a page can
/// read an Apps Script response.
Future<Map<String, dynamic>> scriptGet(String url, {Duration timeout = const Duration(seconds: 20)}) {
  final done = Completer<Map<String, dynamic>>();
  final name = 'otcCallback${Random().nextInt(1 << 30)}';
  final script = web.HTMLScriptElement();
  Timer? timer;

  void cleanup() {
    timer?.cancel();
    globalContext.delete(name.toJS);
    script.remove();
  }

  timer = Timer(timeout, () {
    cleanup();
    if (!done.isCompleted) done.completeError(const ScriptFailure('timeout'));
  });

  globalContext[name] = ((JSAny? data) {
    cleanup();
    if (done.isCompleted) return;
    final decoded = jsonDecode(_stringify(data).toDart);
    done.complete(decoded is Map<String, dynamic> ? decoded : <String, dynamic>{});
  }).toJS;

  script.onerror = ((web.Event _) {
    cleanup();
    if (!done.isCompleted) done.completeError(const ScriptFailure('network'));
  }).toJS;
  script.src = '$url${url.contains('?') ? '&' : '?'}callback=$name';
  web.document.head!.append(script);

  return done.future;
}

/// A failed <script> load says nothing about *why*. Google serves every response
/// with `X-Content-Type-Options: nosniff`, so a sign-in page or plain JSON is
/// refused by the browser exactly like an unreachable host. This second probe
/// tells the two apart: an opaque no-cors fetch resolves for anything that
/// answered at all, and only rejects when nothing did.
Future<bool> isReachable(String endpoint) async {
  try {
    await web.window.fetch(endpoint.toJS, web.RequestInit(mode: 'no-cors', cache: 'no-store')).toDart;
    return true;
  } catch (_) {
    return false;
  }
}

/// What the React version of this app wrote, under its own un-prefixed keys.
String? legacyRead(String key) {
  try {
    return web.window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

void legacyRemove(String key) {
  try {
    web.window.localStorage.removeItem(key);
  } catch (_) {
    // storage blocked — nothing was there to remove
  }
}
