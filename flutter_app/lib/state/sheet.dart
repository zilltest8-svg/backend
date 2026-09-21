import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../core/apps_script.dart';
import '../core/export.dart';
import '../core/types.dart';
import '../platform/platform.dart';

const urlKey = 'otc.sheetUrl';
const idKey = 'otc.sheetId';
const fileKey = 'otc.lastFile';

/// Real deployment URLs come in a few shapes — personal and Workspace accounts
/// differ, and Google often appends a query string when you copy the link:
///   https://script.google.com/macros/s/AKfy…/exec
///   https://script.google.com/a/macros/company.com/s/AKfy…/exec
///   …/exec?usp=sharing        …/exec/       (trailing slash)
/// Anything ending in /exec on script.google.com is accepted.
final _exec = RegExp(r'^https://script\.google\.com/\S*/exec/?(\?\S*)?$', caseSensitive: false);

bool isExecUrl(String value) => _exec.hasMatch(value.trim());

/// Canonical endpoint to call. The validator deliberately accepts a trailing
/// slash and a copied `?usp=sharing`, but Apps Script only serves the bare
/// `/exec` — calling `/exec/` 404s, which surfaces as "couldn't reach".
String execEndpoint(String value) => value.trim().split(RegExp(r'[?#]')).first.replaceAll(RegExp(r'/+$'), '');

/// Why a pasted URL was rejected, in words the user can act on.
String? urlProblem(String value) {
  final v = value.trim();
  if (v.isEmpty || isExecUrl(v)) return null;
  if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(v)) {
    return "That doesn't look like a URL — paste the whole https://… link.";
  }
  if (!RegExp(r'script\.google\.com', caseSensitive: false).hasMatch(v)) {
    return "That's not an Apps Script URL. Don't paste the spreadsheet link — deploy the script and copy the URL it gives you.";
  }
  if (RegExp(r'/dev/?$', caseSensitive: false).hasMatch(v)) {
    return "That's the /dev test URL. Use the /exec one from Deploy → New deployment.";
  }
  if (RegExp(r'/edit', caseSensitive: false).hasMatch(v)) {
    return "That's the script editor link. Use Deploy → New deployment and copy the /exec URL.";
  }
  return 'The deployment URL should end in /exec.';
}

class SavedFile {
  const SavedFile({required this.name, required this.url, required this.folder, required this.folderUrl});

  final String name;
  final String url;
  final String folder;
  final String folderUrl;

  Map<String, dynamic> toJson() => {'name': name, 'url': url, 'folder': folder, 'folderUrl': folderUrl};

  static SavedFile? fromJson(Object? raw) {
    if (raw is! Map) return null;
    return SavedFile(
      name: '${raw['name'] ?? ''}',
      url: '${raw['url'] ?? ''}',
      folder: '${raw['folder'] ?? 'Office Time'}',
      folderUrl: '${raw['folderUrl'] ?? ''}',
    );
  }
}

typedef Say = void Function(String text, bool ok, {String? actionLabel, String? actionHref});

/// The Google Drive connection and the day's export. The connection is only
/// remembered once storage consent is granted.
class SheetController extends ChangeNotifier {
  SheetController({required this.read, required this.remember, required this.day, required this.say}) {
    url = read(urlKey) ?? '';
    sheetId = read(idKey) ?? defaultSheetId;
    final file = read(fileKey);
    // "" is falsy, so a cleared link stays cleared
    if (file != null && file.isNotEmpty) {
      try {
        lastSaved = SavedFile.fromJson(jsonDecode(file));
      } on FormatException {
        lastSaved = null;
      }
    }
  }

  final String? Function(String key) read;
  final void Function(String key, String value) remember;

  /// The day the rest of the app is showing — what an export contains.
  final DayResult Function() day;
  final Say say;

  String url = '';

  /// The Google Sheets document id, used to generate the setup script.
  String sheetId = defaultSheetId;
  bool sending = false;

  /// The connect dialog is shared by every button that needs a connection.
  bool setupOpen = false;

  /// The most recent file written to Drive, so it stays one click away.
  SavedFile? lastSaved;

  /// A usable Apps Script /exec URL is saved.
  bool get configured => isExecUrl(url);
  int get rowCount => toRows(day()).length;

  /// Nothing to export yet.
  bool get empty => rowCount == 0;

  void setUrl(String value) {
    url = value;
    remember(urlKey, value);
    notifyListeners();
  }

  /// Accepts a full Sheets URL or a bare id.
  void setSheetId(String value) {
    sheetId = sheetIdFrom(value) ?? value.trim();
    remember(idKey, sheetId);
    notifyListeners();
  }

  void openSetup() {
    setupOpen = true;
    notifyListeners();
  }

  void closeSetup() {
    setupOpen = false;
    notifyListeners();
  }

  void _setSending(bool value) {
    sending = value;
    notifyListeners();
  }

  /// Translate a failed call into the specific thing to go and fix.
  Future<String> _reachProblem(String kind, String endpoint) async {
    if (kind == 'timeout') {
      return 'The script answered but never called back. Copy the setup script again, then Deploy → New deployment.';
    }
    if (await isReachable(endpoint)) {
      return 'The URL answered, but not with the script\'s reply — so it is NOT a wrong URL. '
          'Either the deployment is still running the old code (Deploy → New deployment, not just Save), '
          'or Google returned a sign-in page because access is not "Anyone". Open the /exec link to see which.';
    }
    return "That URL doesn't resolve at all — it's from a deleted deployment, or you're offline. Redeploy and paste the new /exec URL.";
  }

  /// Save the day as a CSV file in the connected Drive folder.
  Future<bool> saveToDrive() async {
    final today = day();
    if (toRows(today).isEmpty) {
      say('Nothing to save yet.', false);
      return false;
    }
    if (!configured) {
      openSetup();
      return false;
    }
    final filename = csvFilename(today);
    final endpoint = execEndpoint(url);
    _setSending(true);
    try {
      final query =
          'mode=drive&filename=${Uri.encodeQueryComponent(filename)}'
          '&csv=${Uri.encodeQueryComponent(toCSV(today))}';
      final res = await scriptGet('$endpoint?$query');

      if (res['ok'] != true) {
        final error = res['error'];
        say(error != null ? 'Drive refused it: $error' : 'Drive refused the file.', false);
        return false;
      }
      final saved = SavedFile(
        name: '${res['file'] ?? filename}',
        url: '${res['url'] ?? ''}',
        folder: '${res['folder'] ?? 'Office Time'}',
        folderUrl: '${res['folderUrl'] ?? ''}',
      );
      lastSaved = saved;
      remember(fileKey, jsonEncode(saved));
      if (saved.url.isEmpty) {
        say('Saved ${saved.name} to ${saved.folder}.', true);
      } else {
        say('Saved ${saved.name} to ${saved.folder}.', true, actionLabel: 'Open in Drive', actionHref: saved.url);
      }
      return true;
    } on ScriptFailure catch (e) {
      say(await _reachProblem(e.kind, endpoint), false, actionLabel: 'Open /exec', actionHref: endpoint);
      return false;
    } finally {
      _setSending(false);
    }
  }

  /// Call the endpoint with no data, purely to report what is wrong.
  Future<bool> testConnection() async {
    if (!configured) {
      openSetup();
      return false;
    }
    final endpoint = execEndpoint(url);
    _setSending(true);
    try {
      final res = await scriptGet(endpoint);
      if (res['ok'] != true) {
        say('The script ran but failed: ${res['error'] ?? 'unknown error'}', false);
        return false;
      }
      final folder = res['driveFolder'];
      final sheet = res['sheet'];
      final connected = folder is String && folder.isNotEmpty;
      say(
        connected
            ? 'Connected. Drive folder "$folder"${sheet is String && sheet.isNotEmpty ? ', sheet "$sheet"' : ''}.'
            : 'Connected, but this is the old script — copy the setup script again and re-deploy.',
        connected,
      );
      return connected;
    } on ScriptFailure catch (e) {
      say(await _reachProblem(e.kind, endpoint), false, actionLabel: 'Open /exec', actionHref: endpoint);
      return false;
    } finally {
      _setSending(false);
    }
  }

  Future<void> downloadCsv() async {
    final today = day();
    if (toRows(today).isEmpty) return say('Nothing to download yet.', false);
    final bytes = Uint8List.fromList(utf8.encode(toCSV(today)));
    final path = await saveFile(bytes, csvFilename(today), 'text/csv;charset=utf-8;');
    say(path == null ? 'CSV downloaded.' : 'CSV saved to $path.', true);
  }

  /// Drop the saved deployment. The last-saved file link goes too — it belongs
  /// to the old connection and would point somewhere the new one doesn't own.
  void disconnect() {
    url = '';
    lastSaved = null;
    remember(urlKey, '');
    remember(fileKey, '');
    notifyListeners();
    say('Disconnected. Connect a deployment to save again.', true);
  }
}
