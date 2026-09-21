import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/apps_script.dart';
import '../core/compute.dart';
import '../core/time.dart';
import '../core/types.dart';
import '../state/attendance.dart';
import '../state/sheet.dart';
import 'layout.dart';
import 'theme.dart';
import 'widgets.dart';

typedef _Check = ({bool ok, String message, Tone tone});

/// The line under a form that changes as you type, cross-fading between messages.
class _CheckLine extends StatelessWidget {
  const _CheckLine(this.message, this.tone);

  final String message;
  final Tone tone;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 14),
    child: AnimatedSwitcher(
      duration: const Duration(milliseconds: 200),
      layoutBuilder: (current, previous) => Stack(alignment: Alignment.topLeft, children: [...previous, ?current]),
      child: Preview.text(message, key: ValueKey(message), tone: tone),
    ),
  );
}

/* ----------------------------------------------------------------- HR login */

Future<void> showHrLogin(BuildContext context) => showModal<void>(context, builder: (_) => const _HrLoginDialog());

class _HrLoginDialog extends StatefulWidget {
  const _HrLoginDialog();

  @override
  State<_HrLoginDialog> createState() => _HrLoginDialogState();
}

class _HrLoginDialogState extends State<_HrLoginDialog> {
  // The password only ever lives in this dialog's state, and only while it is
  // open — closing it drops both fields.
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();
  bool _show = false;
  bool _closing = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = AppScope.of(context).attendance;
    final busy = api.auth == AuthState.signingIn;

    if (api.auth == AuthState.signedIn && !_closing) {
      _closing = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) Navigator.of(context).pop();
      });
    }

    final ready = _email.text.trim().isNotEmpty && _password.text.isNotEmpty && !busy;
    void submit() {
      if (!ready) return;
      api.signIn(_email.text.trim(), _password.text);
      // Drop the password the moment it is handed over — if sign-in fails the
      // field starts empty rather than holding it while the dialog sits open.
      setState(_password.clear);
    }

    return PopScope(
      canPop: !busy,
      child: ModalShell(
        icon: Icons.login,
        tone: TileTone.violet,
        title: 'Sign in to HR',
        subtitle:
            'Your attendance comes from the HR API, which needs your work login. '
            'The password is sent once and never stored on this device.',
        onClose: busy ? null : () => Navigator.of(context).pop(),
        body: [
          const FieldLabel('Work email'),
          TextField(
            controller: _email,
            autofocus: true,
            enabled: !busy,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            style: m(13),
            decoration: inputDecoration(hint: 'you@company.com'),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _passwordFocus.requestFocus(),
          ),
          const SizedBox(height: 14),
          const FieldLabel('Password'),
          TextField(
            controller: _password,
            focusNode: _passwordFocus,
            enabled: !busy,
            obscureText: !_show,
            autofillHints: const [AutofillHints.password],
            style: m(13),
            decoration: inputDecoration(
              hint: '••••••••',
              suffix: FieldPill(_show ? 'Hide' : 'Show', onPressed: busy ? null : () => setState(() => _show = !_show)),
            ),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => submit(),
          ),
          _CheckLine(
            api.authError ?? (busy ? 'Signing in…' : 'Your HR account — the same login as the HR portal.'),
            api.authError != null
                ? Tone.error
                : busy
                ? Tone.warn
                : Tone.idle,
          ),
        ],
        actions: [
          Btn('Cancel', wide: true, onPressed: busy ? null : () => Navigator.of(context).pop()),
          Btn(busy ? 'Signing in…' : 'Sign in', kind: BtnKind.primary, wide: true, onPressed: ready ? submit : null),
        ],
      ),
    );
  }
}

/* -------------------------------------------------------------- add session */

Future<void> showSessionModal(BuildContext context) => showModal<void>(context, builder: (_) => const _SessionDialog());

class _SessionDialog extends StatefulWidget {
  const _SessionDialog();

  @override
  State<_SessionDialog> createState() => _SessionDialogState();
}

class _SessionDialogState extends State<_SessionDialog> {
  String? _date;
  String _in = '';
  String _out = '';
  bool _touched = false;

  _Check _validate(String date, bool Function(String) isNewDay) {
    final base = startOfDayKey(date);
    if (base == null) return (ok: false, message: 'Pick the date this session belongs to.', tone: Tone.idle);

    final mIn = minutesFromInput(_in);
    if (mIn == null) return (ok: false, message: 'Enter a punch-in time to continue.', tone: Tone.idle);

    final on = 'on ${dateLabel(base)}${isNewDay(date) ? ' — a day you have nothing stored for yet' : ''}';
    if (_out.isEmpty) {
      return (ok: true, message: 'No punch-out — this session will run live, $on.', tone: Tone.warn);
    }

    final mOut = minutesFromInput(_out);
    if (mOut == null) return (ok: false, message: "That punch-out time isn't valid.", tone: Tone.error);
    if (mOut == mIn) return (ok: false, message: "Punch-out can't be the same as punch-in.", tone: Tone.error);

    final crosses = mOut < mIn;
    final length = ((crosses ? mOut + 24 * 60 : mOut) - mIn) * kMin;
    return (
      ok: true,
      message: '${hm(length)} long $on${crosses ? ', crossing midnight into the next day' : ''}.',
      tone: crosses ? Tone.warn : Tone.ok,
    );
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    // Starts on the day being viewed.
    final date = _date ??= app.selected?.key ?? dayKey(nowMs());
    final check = _validate(date, (d) => !app.days.any((day) => day.key == d));

    void submit() {
      setState(() => _touched = true);
      if (!check.ok) return;
      app.addManual(date, _in, _out);
      Navigator.of(context).pop();
    }

    return ModalShell(
      icon: Icons.login,
      tone: TileTone.blue,
      title: 'Add session',
      subtitle: 'Pick the day and enter the punch times — breaks fill themselves in from the gaps.',
      onClose: () => Navigator.of(context).pop(),
      body: [
        const FieldLabel('Date'),
        DateField(
          value: date,
          onChanged: (v) => setState(() => _date = v),
          trailing: FieldPill(
            'Today',
            icon: Icons.calendar_today_outlined,
            onPressed: () => setState(() => _date = dayKey(nowMs())),
          ),
        ),
        const SizedBox(height: 14),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const FieldLabel('Punch in'),
                  TimeField(
                    value: _in,
                    autofocus: true,
                    showNow: true,
                    onChanged: (v) => setState(() => _in = v),
                    onSubmitted: submit,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const FieldLabel('Punch out', note: 'optional'),
                  TimeField(
                    value: _out,
                    showNow: true,
                    onChanged: (v) => setState(() => _out = v),
                    onSubmitted: submit,
                  ),
                ],
              ),
            ),
          ],
        ),
        _CheckLine(check.message, _touched && !check.ok ? Tone.error : check.tone),
      ],
      actions: [
        Btn('Cancel', wide: true, onPressed: () => Navigator.of(context).pop()),
        Btn('Add session', kind: BtnKind.primary, wide: true, onPressed: check.ok ? submit : null),
      ],
    );
  }
}

/* ---------------------------------------------------------------- day sheet */

/// Opens the editable sheet for one `YYYY-MM-DD`.
Future<void> showDaySheet(BuildContext context, String dateKey) =>
    showModal<void>(context, builder: (_) => _DaySheetDialog(dateKey: dateKey));

/// A work session while it is being edited: times as `HH:MM`, blank out = running.
class _Draft {
  _Draft(this.id, this.inText, this.outText);

  final String id;
  String inText;
  String outText;
}

String _toInput(int? t, int base) {
  if (t == null) return '';
  final mins = ((t - base) / kMin).round();
  final wrapped = (mins % (24 * 60) + 24 * 60) % (24 * 60);
  return '${p2(wrapped ~/ 60)}:${p2(wrapped % 60)}';
}

/// `HH:MM` back to absolute ms, rolling past midnight when it lands before `after`.
int? _toStamp(String value, int base, [int? after]) {
  final mins = minutesFromInput(value);
  if (mins == null) return null;
  var t = base + mins * kMin;
  if (after != null && t < after) t += kDayMs;
  return t;
}

/// Drafts back to sessions. Returns null as soon as one row cannot be read.
List<Session>? _toSessions(List<_Draft> drafts, int base) {
  final out = <Session>[];
  for (final d in drafts) {
    final punchIn = _toStamp(d.inText, base);
    if (punchIn == null) return null;
    final typed = d.outText.trim().isNotEmpty;
    final punchOut = typed ? _toStamp(d.outText, base, punchIn) : null;
    if (typed && punchOut == null) return null;
    out.add(Session(id: d.id, inAt: punchIn, out: punchOut));
  }
  return out..sort((a, b) => a.inAt.compareTo(b.inAt));
}

_Check _validateSheet(List<_Draft> drafts, int base) {
  if (drafts.isEmpty) return (ok: true, message: 'No sessions — submitting clears this day.', tone: Tone.warn);
  for (final (i, d) in drafts.indexed) {
    if (minutesFromInput(d.inText) == null) {
      return (ok: false, message: 'Session ${i + 1} needs a punch-in time.', tone: Tone.error);
    }
    if (d.outText.trim().isNotEmpty && minutesFromInput(d.outText) == null) {
      return (ok: false, message: 'Session ${i + 1} has an unreadable punch-out.', tone: Tone.error);
    }
    if (d.outText.trim().isNotEmpty && d.outText == d.inText) {
      return (ok: false, message: 'Session ${i + 1} starts and ends at the same minute.', tone: Tone.error);
    }
  }

  final sessions = _toSessions(drafts, base);
  if (sessions == null) return (ok: false, message: 'One of those times cannot be read.', tone: Tone.error);

  // Overlaps get silently clipped by the calculation, so say so rather than absorb it.
  for (var i = 1; i < sessions.length; i++) {
    final prevOut = sessions[i - 1].out;
    if (prevOut == null) {
      return (ok: false, message: 'Session $i is still running but another follows it.', tone: Tone.error);
    }
    if (sessions[i].inAt < prevOut) {
      return (ok: false, message: 'Session ${i + 1} starts before session $i ends.', tone: Tone.error);
    }
  }

  if (sessions.any((s) => s.out == null)) {
    return (ok: true, message: 'The last session has no punch-out — it stays running.', tone: Tone.warn);
  }
  return (ok: true, message: 'Every punch reads cleanly. Submit saves the day to history.', tone: Tone.ok);
}

/// Row length straight from the two `HH:MM` strings, so it tracks every keystroke.
String _lengthOf(String from, String to) {
  final a = minutesFromInput(from);
  final b = minutesFromInput(to);
  if (a == null) return '--:--';
  if (b == null) return 'running';
  return hm((b < a ? b + 24 * 60 - a : b - a) * kMin);
}

/// The day as an editable sheet — the same shape the export writes, one row per
/// work session and per break. Only sessions are held in state: breaks are the
/// gaps, so editing a break's start moves the punch-out in front of it and
/// editing its end moves the punch-in after it.
class _DaySheetDialog extends StatefulWidget {
  const _DaySheetDialog({required this.dateKey});

  final String dateKey;

  @override
  State<_DaySheetDialog> createState() => _DaySheetDialogState();
}

class _DaySheetDialogState extends State<_DaySheetDialog> {
  late final int _base = startOfDayKey(widget.dateKey) ?? 0;

  // Loaded once per opening: the live clock rebuilds the day under this dialog
  // every tick, and that must never overwrite what is being typed.
  List<_Draft>? _drafts;

  @override
  Widget build(BuildContext context) {
    // A running session's totals move with the clock.
    return ValueListenableBuilder<int>(
      valueListenable: AppScope.of(context).clock,
      builder: (context, _, _) => _sheet(context),
    );
  }

  Widget _sheet(BuildContext context) {
    final app = AppScope.of(context);
    final drafts = _drafts ??= [
      for (final s in [
        ...?app.days.where((d) => d.key == widget.dateKey).firstOrNull?.sessions,
      ]..sort((a, b) => a.inAt.compareTo(b.inAt)))
        _Draft(s.id, _toInput(s.inAt, _base), _toInput(s.out, _base)),
    ];

    final check = _validateSheet(drafts, _base);
    final preview = computeDay(_toSessions(drafts, _base) ?? const [], app.settings, app.now);

    void submit() {
      final parsed = _toSessions(drafts, _base);
      if (!check.ok || parsed == null) return;
      app.commitDay(widget.dateKey, parsed);
      Navigator.of(context).pop();
    }

    final rows = <Widget>[];
    var brk = 0;
    for (final (index, draft) in drafts.indexed) {
      final prev = index == 0 ? null : drafts[index - 1];
      if (prev != null &&
          prev.outText.trim().isNotEmpty &&
          draft.inText.trim().isNotEmpty &&
          prev.outText != draft.inText) {
        // A break edge is really a punch on one of its neighbours.
        rows.add(
          _SheetRow(
            key: ValueKey('b-${draft.id}'),
            no: brk += 1,
            isBreak: true,
            from: prev.outText,
            to: draft.inText,
            onFrom: (v) => setState(() => prev.outText = v),
            onTo: (v) => setState(() => draft.inText = v),
          ),
        );
      }
      rows.add(
        _SheetRow(
          key: ValueKey('w-${draft.id}'),
          no: index + 1,
          isBreak: false,
          from: draft.inText,
          to: draft.outText,
          onFrom: (v) => setState(() => draft.inText = v),
          onTo: (v) => setState(() => draft.outText = v),
          onRemove: () => setState(() => drafts.removeAt(index)),
        ),
      );
    }

    Widget total(String label, String value, [Color color = C.ink]) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Kicker(label, size: 9.5, color: C.muted, spacing: 0.9),
        const SizedBox(height: 3),
        Text(
          value,
          style: m(14, color: color, weight: FontWeight.w600),
        ),
      ],
    );

    return ModalShell(
      wide: true,
      icon: Icons.table_chart_outlined,
      tone: TileTone.green,
      title: _base == 0 ? widget.dateKey : dateLabel(_base),
      subtitle:
          '${_base == 0 ? '' : '${weekday(_base)} — '}check the punches, fill in the last punch-out, '
          'then submit to save this day to history.',
      onClose: () => Navigator.of(context).pop(),
      body: [
        Padding(
          padding: const EdgeInsets.fromLTRB(6, 0, 6, 8),
          child: _SheetGrid(
            no: _sheetHead('No.'),
            kind: _sheetHead('Type'),
            from: _sheetHead('Punch in'),
            to: _sheetHead('Punch out'),
            length: _sheetHead('Duration', right: true),
            remove: const SizedBox.shrink(),
          ),
        ),
        const Divider(height: 1, color: C.line2),
        const SizedBox(height: 8),
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 292),
          child: SingleChildScrollView(
            child: Column(
              children: [
                if (rows.isEmpty) const EmptyRow('Nothing on this day yet — add a row.'),
                for (final row in rows) Padding(padding: const EdgeInsets.only(bottom: 6), child: row),
              ],
            ),
          ),
        ),
        const SizedBox(height: 6),
        Btn(
          'Add row',
          icon: Icons.add,
          kind: BtnKind.dashed,
          wide: true,
          onPressed: () => setState(() {
            final last = drafts.lastOrNull;
            final start = last != null && last.outText.trim().isNotEmpty ? last.outText : inputTimeNow();
            drafts.add(_Draft('d${nowMs()}', start, ''));
          }),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: C.card2,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: C.line2),
          ),
          child: AutoGrid(
            minWidth: 92,
            gap: 10,
            children: [
              total('Total work', hm(preview.worked), C.green),
              total('Total break', hm(preview.breakMs), C.amber),
              total('Time in office', hm(preview.office)),
              total('First in', clockTime(preview.first)),
              total('Can leave at', preview.leave == null ? '--:--' : clockShort(preview.leave)),
            ],
          ),
        ),
        _CheckLine(check.message, check.tone),
      ],
      actions: [
        Btn('Cancel', wide: true, onPressed: () => Navigator.of(context).pop()),
        Btn('Submit to history', kind: BtnKind.primary, wide: true, onPressed: check.ok ? submit : null),
      ],
    );
  }
}

Widget _sheetHead(String text, {bool right = false}) => Text(
  text.toUpperCase(),
  textAlign: right ? TextAlign.right : TextAlign.left,
  style: t(10, color: C.muted, weight: FontWeight.w600, spacing: 0.9),
);

class _SheetGrid extends StatelessWidget {
  const _SheetGrid({
    required this.no,
    required this.kind,
    required this.from,
    required this.to,
    required this.length,
    required this.remove,
  });

  final Widget no;
  final Widget kind;
  final Widget from;
  final Widget to;
  final Widget length;
  final Widget remove;

  /// On a phone the type column is just its dot, which leaves the room to the
  /// two time fields.
  static bool compact(double width) => width < 440;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final tight = compact(box.maxWidth);
      return Row(
        children: [
          SizedBox(width: tight ? 16 : 26, child: no),
          const SizedBox(width: 8),
          SizedBox(
            width: tight ? 8 : 70,
            child: ClipRect(child: kind),
          ),
          const SizedBox(width: 8),
          Expanded(child: from),
          const SizedBox(width: 8),
          Expanded(child: to),
          const SizedBox(width: 8),
          SizedBox(
            width: tight ? 40 : 58,
            child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: length),
          ),
          const SizedBox(width: 8),
          SizedBox(width: 28, child: remove),
        ],
      );
    },
  );
}

class _SheetRow extends StatelessWidget {
  const _SheetRow({
    super.key,
    required this.no,
    required this.isBreak,
    required this.from,
    required this.to,
    required this.onFrom,
    required this.onTo,
    this.onRemove,
  });

  final int no;
  final bool isBreak;
  final String from;
  final String to;
  final ValueChanged<String> onFrom;
  final ValueChanged<String> onTo;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final color = isBreak ? C.amber : C.ink;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      decoration: BoxDecoration(
        color: isBreak ? C.amber.withValues(alpha: 0.06) : C.card2,
        borderRadius: BorderRadius.circular(11),
      ),
      child: _SheetGrid(
        no: Text(
          '$no',
          textAlign: TextAlign.center,
          style: m(11, color: C.muted, weight: FontWeight.w600),
        ),
        kind: Row(
          children: [
            Dot(isBreak ? C.amber : C.green),
            // Flexible all the way down, so the compact grid can squeeze it to the dot.
            Flexible(
              child: Padding(
                padding: const EdgeInsets.only(left: 7),
                child: Text(
                  isBreak ? 'Break' : 'Work',
                  softWrap: false,
                  overflow: TextOverflow.clip,
                  style: t(12.5, color: color, weight: FontWeight.w600),
                ),
              ),
            ),
          ],
        ),
        from: TimeField(value: from, dense: true, onChanged: onFrom),
        to: TimeField(value: to, dense: true, showNow: !isBreak, onChanged: onTo),
        length: Text(
          _lengthOf(from, to),
          textAlign: TextAlign.right,
          style: m(12, color: color),
        ),
        remove: onRemove == null
            ? const SizedBox.shrink()
            : XButton(size: 26, danger: true, tooltip: 'Remove session $no', onPressed: onRemove),
      ),
    );
  }
}

/* -------------------------------------------------------------- drive setup */

/// The one-time connect dialog, shared by every button that needs a connection.
/// The link is made through a small Apps Script the user deploys once — this
/// generates that script already pointed at their own sheet and Drive folder.
Future<void> showSheetSetup(BuildContext context) =>
    showModal<void>(context, builder: (_) => const _SheetSetupDialog());

class _SheetSetupDialog extends StatefulWidget {
  const _SheetSetupDialog();

  @override
  State<_SheetSetupDialog> createState() => _SheetSetupDialogState();
}

class _SheetSetupDialogState extends State<_SheetSetupDialog> {
  TextEditingController? _draft;
  TextEditingController? _link;
  bool _copied = false;

  @override
  void dispose() {
    _draft?.dispose();
    _link?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sheet = AppScope.of(context).sheet;
    final draft = _draft ??= TextEditingController(text: sheet.url);
    final link = _link ??= TextEditingController(text: sheet.sheetId.isEmpty ? '' : sheetUrlFrom(sheet.sheetId));

    final id = sheetIdFrom(link.text);
    final valid = isExecUrl(draft.text);
    void close() => Navigator.of(context).pop();

    void save() {
      if (!valid) return;
      if (id != null) sheet.setSheetId(id);
      sheet.setUrl(draft.text.trim());
      close();
    }

    Widget step(int n, Widget child) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 20,
            child: Text(
              '$n.',
              style: t(12, color: C.accent, weight: FontWeight.w700, height: 1.6),
            ),
          ),
          Expanded(child: child),
        ],
      ),
    );
    final body = t(12, color: C.dim, height: 1.6);
    final strong = t(12, weight: FontWeight.w700, height: 1.6);

    return ModalShell(
      wide: true,
      icon: Icons.add_to_drive,
      tone: TileTone.green,
      title: sheet.configured ? 'Reconnect Google Drive' : 'Connect Google Drive',
      subtitle: sheet.configured
          ? 'Already connected. Paste a new deployment URL to point it somewhere else, or disconnect.'
          : 'A one-time authorisation. After this, saving is a single click.',
      onClose: close,
      body: [
        const FieldLabel('Your Google Sheet link (optional)'),
        TextField(
          controller: link,
          autocorrect: false,
          style: m(13),
          decoration: inputDecoration(hint: 'https://docs.google.com/spreadsheets/d/…/edit'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 10),
        Preview.text(
          link.text.trim().isEmpty
              ? 'Drive works without this — add a sheet link only if you also want rows appended.'
              : id != null
              ? 'Sheet id ${id.substring(0, 12)}… — the script is written for it.'
              : "That isn't a Google Sheets link.",
          tone: link.text.trim().isEmpty
              ? Tone.idle
              : id != null
              ? Tone.ok
              : Tone.error,
        ),
        const SizedBox(height: 18),
        step(
          1,
          Btn(
            _copied ? '✓ Script copied' : 'Copy setup script',
            kind: BtnKind.dashed,
            wide: true,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: buildScript(id ?? sheet.sheetId)));
              if (!mounted) return;
              setState(() => _copied = true);
              await Future<void>.delayed(const Duration(seconds: 2));
              if (mounted) setState(() => _copied = false);
            },
          ),
        ),
        step(
          2,
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('Open ', style: body),
              LinkBtn('script.new', onPressed: () => openLink('https://script.new')),
              Text(', select all, paste, save.', style: body),
            ],
          ),
        ),
        step(
          3,
          Text.rich(
            TextSpan(
              style: body,
              children: [
                TextSpan(text: 'Deploy → New deployment → Web app', style: strong),
                const TextSpan(text: ', run as '),
                TextSpan(text: 'Me', style: strong),
                const TextSpan(text: ', access '),
                TextSpan(text: 'Anyone', style: strong),
                const TextSpan(text: '.'),
              ],
            ),
          ),
        ),
        step(
          4,
          Text.rich(
            TextSpan(
              style: body,
              children: [
                const TextSpan(text: 'Authorise it — it asks for '),
                TextSpan(text: 'Drive', style: strong),
                const TextSpan(
                  text: ' access so it can save the file. Your own script shows an "unverified" warning: ',
                ),
                TextSpan(text: 'Advanced → Go to project', style: strong),
                const TextSpan(text: '.'),
              ],
            ),
          ),
        ),
        step(5, Text('Paste the /exec URL it gives you below.', style: body)),
        const SizedBox(height: 10),
        const FieldLabel('Apps Script web app URL'),
        TextField(
          controller: draft,
          autocorrect: false,
          style: m(13),
          decoration: inputDecoration(hint: 'https://script.google.com/macros/s/.../exec'),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => save(),
        ),
        const SizedBox(height: 10),
        Preview.text(
          draft.text.trim().isEmpty
              ? 'Not connected yet — Download CSV works without any of this.'
              : valid
              ? 'Looks right. Save it and Drive is connected.'
              : urlProblem(draft.text) ?? '',
          tone: draft.text.trim().isEmpty
              ? Tone.idle
              : valid
              ? Tone.ok
              : Tone.error,
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: valid
              ? LinkBtn(
                  sheet.sending ? 'Testing…' : 'Test this connection',
                  onPressed: sheet.sending
                      ? null
                      : () {
                          sheet.setUrl(draft.text.trim());
                          sheet.testConnection();
                        },
                )
              : LinkBtn(
                  'Skip this — download the CSV instead',
                  onPressed: () {
                    sheet.downloadCsv();
                    close();
                  },
                ),
        ),
      ],
      actions: [
        Btn('Cancel', wide: true, onPressed: close),
        if (sheet.configured)
          Btn(
            'Disconnect',
            kind: BtnKind.danger,
            wide: true,
            onPressed: () {
              sheet.disconnect();
              close();
            },
          ),
        Btn('Save & connect', kind: BtnKind.primary, wide: true, onPressed: valid ? save : null),
      ],
    );
  }
}
