/// Client for the attendance proxy in `server/index.mjs`.
///
/// Nothing here talks to `api.hr.zilmoney.com` directly. Every call goes to the
/// proxy under `/api/punch/*`, and the session cookie the HR API issues stays on
/// the proxy. The only credential this file ever handles is the password the
/// user just typed, which goes out once and is never stored.
///
/// In a browser the proxy is the page's own origin, so its httpOnly cookie rides
/// along by itself. A desktop build has no cookie jar, so the sealed `punch_sid`
/// the proxy hands back is kept here and replayed, and handed to `onCookie` so
/// it can be stored — otherwise every launch would start signed out. It is
/// ciphertext only the proxy can open, and the proxy expires it by itself.
///
/// Three upstream routes, doing three different jobs:
///   my-today        the punches. Comes back in the same shape the Telemetry box
///                   accepts, so `parsePayload` reads it with no new parser.
///   my-sync         pulls records off the punch devices into HR, and reports
///                   what it added. Returns no attendance data.
///   my-sync-status  where the last pull got to.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;

import '../core/compute.dart';
import '../core/time.dart';
import '../core/types.dart';

const _cookieName = 'punch_sid';

class HrUser {
  const HrUser({this.name, this.email});

  final String? name;
  final String? email;

  static HrUser? fromJson(Object? raw) {
    if (raw is! Map) return null;
    return HrUser(name: raw['name']?.toString(), email: raw['email']?.toString());
  }
}

/// Thrown with `unauthenticated` set when the proxy says the session is gone.
class AttendanceError implements Exception {
  const AttendanceError(this.message, {this.unauthenticated = false});

  final String message;
  final bool unauthenticated;

  @override
  String toString() => message;
}

class TodayReport {
  const TodayReport({
    required this.sessions,
    required this.targetMinutes,
    required this.breakMinutes,
    required this.status,
    required this.totalMinutes,
    required this.raw,
  });

  final List<Session> sessions;

  /// `target_minutes` from the API, falling back to a standard 8h day.
  final int targetMinutes;

  /// `break_minutes` — the break the HR side measured.
  final int breakMinutes;

  /// `working` / `break` / `out`, as the HR API sees it.
  final String? status;

  /// The API's own worked total.
  final int? totalMinutes;
  final Object? raw;
}

class SyncDevice {
  const SyncDevice({required this.name, required this.success, required this.totalRecords, required this.newRecords});

  final String name;
  final bool success;
  final int totalRecords;
  final int newRecords;
}

class SyncResult {
  const SyncResult({
    required this.status,
    required this.message,
    required this.newRecords,
    required this.devices,
    required this.rangeStart,
    required this.rangeEnd,
    required this.at,
    required this.raw,
  });

  /// `completed`, `failed`, whatever the API reports.
  final String status;
  final String message;
  final int newRecords;
  final List<SyncDevice> devices;

  /// The range the pull actually covered, read back from the API's own
  /// `filters` rather than from what we sent — so the strip on screen reports
  /// what the HR side did, not merely what was asked of it.
  final String rangeStart;
  final String rangeEnd;
  final int at;
  final Object? raw;
}

class AttendanceClient {
  AttendanceClient(this._proxyBase, {String? cookie, this.onCookie}) : _cookie = cookie;

  /// Where the proxy lives for a desktop build; a browser uses its own origin.
  final String Function() _proxyBase;

  /// Told whenever the session cookie is set, rotated or cleared (null).
  final void Function(String? cookie)? onCookie;

  String? _cookie;

  void _setCookie(String? value) {
    if (value == _cookie) return;
    _cookie = value;
    onCookie?.call(value);
  }

  Uri _uri(String path) {
    if (kIsWeb) return Uri.base.resolve('/api/punch$path');
    final base = _proxyBase().trim().replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$base/api/punch$path');
  }

  Future<Map<String, dynamic>> _call(String path, String method, [Object? body]) async {
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (!kIsWeb && _cookie != null) 'Cookie': '$_cookieName=$_cookie',
    };

    final http.Response res;
    try {
      final uri = _uri(path);
      final pending = method == 'GET'
          ? http.get(uri, headers: headers)
          : http.post(uri, headers: headers, body: jsonEncode(body ?? const {}));
      res = await pending.timeout(const Duration(seconds: 30));
    } catch (_) {
      throw const AttendanceError('Could not reach the attendance server. Check your internet connection.');
    }

    if (!kIsWeb) _keepCookie(res.headers['set-cookie']);

    Object? decoded;
    try {
      decoded = jsonDecode(res.body);
    } on FormatException {
      decoded = null;
    }
    final bag = decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};

    if (res.statusCode < 200 || res.statusCode >= 300) {
      final error = bag['error'];
      throw AttendanceError(
        error is String ? error : 'Request failed (HTTP ${res.statusCode}).',
        unauthenticated: res.statusCode == 401,
      );
    }
    return bag;
  }

  void _keepCookie(String? header) {
    if (header == null) return;
    final hit = RegExp('(?:^|[,;]\\s*)$_cookieName=([^;,]*)').firstMatch(header);
    if (hit == null) return;
    final value = hit.group(1)!;
    // An empty value is the proxy clearing the session, not setting one.
    _setCookie(value.isEmpty ? null : value);
  }

  /* ----------------------------------------------------------------- session */

  Future<({bool authenticated, HrUser? user})> checkSession() async {
    final body = await _call('/session', 'GET');
    return (authenticated: body['authenticated'] == true, user: HrUser.fromJson(body['user']));
  }

  Future<HrUser?> login(String email, String password) async {
    final body = await _call('/login', 'POST', {'email': email, 'password': password});
    return HrUser.fromJson(body['user']);
  }

  Future<void> logout() async {
    try {
      await _call('/logout', 'POST');
    } finally {
      _setCookie(null);
    }
  }

  /* ------------------------------------------------------------------- today */

  /// GET, not POST — my-today answers 405 to anything else.
  Future<TodayReport> fetchToday() async {
    final body = await _call('/today', 'GET');
    final data = body['data'];
    final bag = data is Map ? data : const {};

    // The response is a PunchPayload, which the app already knows how to read —
    // dedup by punch-in, `current_session` folded into `sessions_today`, and a
    // closed copy of a punch beating an open one.
    final ParseResult parsed;
    try {
      parsed = parsePayloadData(data);
    } on FormatException catch (e) {
      throw AttendanceError(e.message);
    }

    final status = bag['status'];
    final total = bag['total_today_minutes'];
    return TodayReport(
      sessions: parsed.sessions,
      targetMinutes: parsed.target ?? _intOr(bag['target_minutes'], 480),
      breakMinutes: _intOr(bag['break_minutes'], 0),
      status: status is String ? status : null,
      totalMinutes: total is num ? total.round() : null,
      raw: data,
    );
  }

  /* -------------------------------------------------------------------- sync */

  /// Triggers the device pull. POST with the range, and it returns a report.
  Future<SyncResult> runSync(String startDate, String endDate) async {
    final body = await _call('/sync', 'POST', {'start_date': startDate, 'end_date': endDate});
    final data = body['data'];
    final bag = data is Map ? data : const {};
    final devices = bag['devices'] is List ? (bag['devices'] as List).whereType<Map>() : const <Map>[];
    final filters = bag['filters'] is Map ? bag['filters'] as Map : const {};

    final status = bag['status'];
    final message = bag['message'];
    return SyncResult(
      status: status is String ? status : 'unknown',
      message: message is String ? message : 'Sync finished.',
      newRecords: _intOr(bag['total_new_records'], 0),
      devices: [
        for (final d in devices)
          SyncDevice(
            name: d['device_name'] is String ? d['device_name'] as String : 'Device',
            success: d['success'] != false,
            totalRecords: _intOr(d['total_records'], 0),
            newRecords: _intOr(d['new_records_added'], 0),
          ),
      ],
      rangeStart: _stringOr(filters['start_date'], startDate),
      rangeEnd: _stringOr(filters['end_date'], endDate),
      at: nowMs(),
      raw: data,
    );
  }
}

int _intOr(Object? v, int fallback) => v is num && v.isFinite ? v.round() : fallback;

String _stringOr(Object? v, String fallback) {
  if (v is String && v.isNotEmpty) return v;
  if (v is num) return '$v';
  return fallback;
}
