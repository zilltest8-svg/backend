import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'script_failure.dart';

/// Writes the file into Downloads and returns where it landed.
Future<String?> saveFile(Uint8List bytes, String filename, String mime) async {
  final dir = await getDownloadsDirectory() ?? await getApplicationDocumentsDirectory();
  final file = File('${dir.path}${Platform.pathSeparator}$filename');
  await file.writeAsBytes(bytes, flush: true);
  return file.path;
}

/// A desktop build is not bound by CORS, so the Apps Script reply is simply
/// fetched and read — no JSONP callback is needed to see it.
Future<Map<String, dynamic>> scriptGet(String url, {Duration timeout = const Duration(seconds: 20)}) async {
  final http.Response res;
  try {
    res = await http.get(Uri.parse(url)).timeout(timeout);
  } on TimeoutException {
    throw const ScriptFailure('timeout');
  } catch (_) {
    throw const ScriptFailure('network');
  }
  try {
    final body = jsonDecode(res.body);
    if (body is Map<String, dynamic>) return body;
  } on FormatException {
    // A sign-in page or an error page: it answered, but not with the script's reply.
  }
  throw const ScriptFailure('network');
}

/// Whether anything at all answers at that address.
Future<bool> isReachable(String endpoint) async {
  try {
    await http.get(Uri.parse(endpoint)).timeout(const Duration(seconds: 12));
    return true;
  } catch (_) {
    return false;
  }
}

/// Only a browser has storage written by the React version of the app.
String? legacyRead(String key) => null;

void legacyRemove(String key) {}
