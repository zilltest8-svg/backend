import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show TextInputFormatter;
import 'package:url_launcher/url_launcher.dart';

import '../core/time.dart';
import '../core/verdict.dart' show Tone;
import 'theme.dart';

export '../core/verdict.dart' show Tone;

Future<void> openLink(String href) => launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);

/* ------------------------------------------------------------------- motion */

/// Fades and lifts its child into place once, when it first appears.
class Entrance extends StatelessWidget {
  const Entrance({super.key, required this.child, this.delay = 0, this.dy = 14, this.dx = 0, this.ms = 450});

  final Widget child;

  /// Seconds to wait, so a row of cards arrives one after another.
  final double delay;
  final double dy;
  final double dx;
  final int ms;

  @override
  Widget build(BuildContext context) {
    final total = ms + (delay * 1000).round();
    final start = total == 0 ? 0.0 : (delay * 1000) / total;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: total),
      curve: Interval(start, 1, curve: ease),
      builder: (context, v, child) => Opacity(
        opacity: v.clamp(0, 1),
        child: Transform.translate(offset: Offset(dx * (1 - v), dy * (1 - v)), child: child),
      ),
      child: child,
    );
  }
}

/// A slow opacity pulse, for anything that is live.
class Pulse extends StatefulWidget {
  const Pulse({super.key, required this.child, this.on = true, this.low = 0.3, this.ms = 1700});

  final Widget child;
  final bool on;
  final double low;
  final int ms;

  @override
  State<Pulse> createState() => _PulseState();
}

class _PulseState extends State<Pulse> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(
    vsync: this,
    duration: Duration(milliseconds: widget.ms ~/ 2),
  );

  @override
  void initState() {
    super.initState();
    if (widget.on) _c.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(Pulse old) {
    super.didUpdateWidget(old);
    if (widget.on == old.on) return;
    if (widget.on) {
      _c.repeat(reverse: true);
    } else {
      _c
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: Tween(begin: 1.0, end: widget.low).animate(CurvedAnimation(parent: _c, curve: Curves.easeInOut)),
    child: widget.child,
  );
}

/// Opens and closes to its child's own height — CSS `height: auto`, animated.
class Reveal extends StatelessWidget {
  const Reveal({super.key, required this.open, required this.child, this.ms = 260});

  final bool open;
  final Widget child;
  final int ms;

  @override
  Widget build(BuildContext context) => AnimatedSize(
    duration: Duration(milliseconds: ms),
    curve: ease,
    alignment: Alignment.topCenter,
    child: AnimatedOpacity(
      duration: Duration(milliseconds: ms),
      opacity: open ? 1 : 0,
      child: open ? child : const SizedBox(width: double.infinity),
    ),
  );
}

/* -------------------------------------------------------------------- cards */

class AppCard extends StatefulWidget {
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(18), this.clip = false});

  final Widget child;
  final EdgeInsets padding;
  final bool clip;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) => MouseRegion(
    onEnter: (_) => setState(() => _hover = true),
    onExit: (_) => setState(() => _hover = false),
    // The card rises a little towards the pointer.
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 260),
      curve: ease,
      transform: Matrix4.translationValues(0, _hover ? -2 : 0, 0),
      width: double.infinity,
      padding: widget.padding,
      clipBehavior: widget.clip ? Clip.antiAlias : Clip.none,
      decoration: raised(lift: _hover ? 1 : 0),
      child: widget.child,
    ),
  );
}

/// A title on the left and its actions on the right, wrapping when narrow.
class CardHead extends StatelessWidget {
  const CardHead({super.key, required this.title, this.trailing});

  final Widget title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.spaceBetween,
    crossAxisAlignment: WrapCrossAlignment.center,
    spacing: 12,
    runSpacing: 8,
    children: [title, ?trailing],
  );
}

class H2 extends StatelessWidget {
  const H2(this.text, {super.key, this.leading});

  final String text;
  final Widget? leading;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      if (leading != null) ...[leading!, const SizedBox(width: 10)],
      Flexible(
        child: Text(text, style: t(15, weight: FontWeight.w600, spacing: -0.2)),
      ),
    ],
  );
}

/// The small upper-case caption above a field or a figure.
class Kicker extends StatelessWidget {
  const Kicker(this.text, {super.key, this.size = 10.5, this.color = C.dim, this.spacing = 1.3});

  final String text;
  final double size;
  final Color color;
  final double spacing;

  @override
  Widget build(BuildContext context) => Text(
    text.toUpperCase(),
    style: t(size, color: color, weight: FontWeight.w600, spacing: spacing),
  );
}

class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, this.note});

  final String text;
  final String? note;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      children: [
        Kicker(text),
        if (note != null) ...[const SizedBox(width: 6), Text(note!, style: t(10, color: C.muted))],
      ],
    ),
  );
}

class Lead extends StatelessWidget {
  const Lead(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: t(12.5, color: C.muted, height: 1.5));
}

class Hint extends StatelessWidget {
  const Hint(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 12),
    child: Text(text, style: t(11.5, color: C.muted, height: 1.65)),
  );
}

class EmptyRow extends StatelessWidget {
  const EmptyRow(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 26),
    child: Center(
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: t(12.5, color: C.muted),
      ),
    ),
  );
}

enum TileTone { blue, green, amber, violet, red, plain }

class IconTile extends StatelessWidget {
  const IconTile(this.icon, {super.key, this.tone = TileTone.plain, this.small = false});

  final IconData icon;
  final TileTone tone;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      TileTone.blue => C.blue,
      TileTone.green => C.green,
      TileTone.amber => C.amber,
      TileTone.violet => C.violet,
      TileTone.red => C.red,
      TileTone.plain => C.ink,
    };
    final side = small ? 28.0 : 34.0;
    return Container(
      width: side,
      height: side,
      decoration: BoxDecoration(
        color: tone == TileTone.plain ? C.raised : color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(small ? 9 : 11),
      ),
      child: Icon(icon, size: small ? 15 : 18, color: color),
    );
  }
}

/* -------------------------------------------------------------------- chips */

enum ChipTone { green, amber, blue, muted }

class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.tone = ChipTone.muted, this.dot = false, this.pulse = false});

  final String label;
  final ChipTone tone;
  final bool dot;
  final bool pulse;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      ChipTone.green => C.green,
      ChipTone.amber => C.amber,
      ChipTone.blue => C.blue,
      ChipTone.muted => C.muted,
    };
    final quiet = tone == ChipTone.muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: quiet ? Colors.white.withValues(alpha: 0.04) : color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: quiet ? C.line : color.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[Pulse(on: pulse, child: Dot(color, size: 6)), const SizedBox(width: 6)],
          Text(
            label,
            style: t(11, color: color, weight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class Dot extends StatelessWidget {
  const Dot(this.color, {super.key, this.size = 7});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
}

/// The one-line strip that says what is about to happen, or what went wrong.
class Preview extends StatelessWidget {
  const Preview({super.key, required this.tone, required this.children, this.tail});

  Preview.text(String text, {super.key, required this.tone})
    : children = [Text(text, style: t(12, color: toneColor(tone), height: 1.5))],
      tail = null;

  final Tone tone;
  final List<Widget> children;

  /// Pushed to the far right of the strip.
  final Widget? tail;

  static Color toneColor(Tone tone) => switch (tone) {
    Tone.ok => C.green,
    Tone.warn => C.amber,
    Tone.error => C.red,
    Tone.idle => C.muted,
  };

  @override
  Widget build(BuildContext context) {
    final color = toneColor(tone);
    final idle = tone == Tone.idle;
    final body = Wrap(spacing: 10, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: children);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: idle ? Colors.white.withValues(alpha: 0.03) : color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: idle ? C.line : color.withValues(alpha: 0.22)),
      ),
      child: DefaultTextStyle.merge(
        style: t(12, color: color),
        // The tail sits at the far end of the line, and drops under it when narrow.
        child: tail == null
            ? body
            : Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 10,
                runSpacing: 4,
                children: [body, tail!],
              ),
      ),
    );
  }
}

/// `4h 30m` with a dimmed `12s` behind it — the part that is still moving.
class ValueWithTail extends StatelessWidget {
  const ValueWithTail(this.value, {super.key, this.tail, required this.style, this.tailScale = 0.6});

  final String value;
  final String? tail;
  final TextStyle style;
  final double tailScale;

  @override
  Widget build(BuildContext context) => Text.rich(
    TextSpan(
      text: value,
      children: [
        if (tail != null)
          TextSpan(
            text: ' $tail',
            style: TextStyle(fontSize: style.fontSize! * tailScale, color: C.muted, fontWeight: FontWeight.w500),
          ),
      ],
    ),
    style: style,
  );
}

/* ------------------------------------------------------------------ buttons */

enum BtnKind { normal, primary, ghost, danger, dashed, done }

class Btn extends StatefulWidget {
  const Btn(
    this.label, {
    super.key,
    this.icon,
    this.onPressed,
    this.kind = BtnKind.normal,
    this.small = false,
    this.wide = false,
    this.tooltip,
    this.padding,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final BtnKind kind;
  final bool small;
  final bool wide;
  final String? tooltip;
  final EdgeInsets? padding;

  @override
  State<Btn> createState() => _BtnState();
}

class _BtnState extends State<Btn> {
  bool _hover = false;
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onPressed != null;
    final hot = enabled && _hover;

    // Top and bottom of the face, the label, and whether it stands off the page.
    final (Color top, Color bottom, Color fg, bool solid) = switch (widget.kind) {
      BtnKind.normal => (Color(hot ? 0xFF303030 : 0xFF262626), Color(hot ? 0xFF1A1A1A : 0xFF141414), C.ink, true),
      BtnKind.primary || BtnKind.done => (Colors.white, Color(hot ? 0xFFDCDCDC : 0xFFC4C4C4), C.onAccent, true),
      BtnKind.ghost => (
        Colors.white.withValues(alpha: hot ? 0.06 : 0),
        Colors.white.withValues(alpha: hot ? 0.03 : 0),
        hot ? C.ink : C.dim,
        false,
      ),
      BtnKind.danger || BtnKind.dashed => (
        Colors.white.withValues(alpha: hot ? 0.12 : 0.06),
        Colors.white.withValues(alpha: hot ? 0.05 : 0.02),
        C.ink,
        false,
      ),
    };

    final size = widget.small ? 12.0 : 12.5;
    final label = Text(
      widget.label,
      overflow: TextOverflow.ellipsis,
      style: t(size, color: fg, weight: FontWeight.w600),
    );
    final content = Row(
      mainAxisSize: widget.wide ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (widget.icon != null) ...[
          Icon(widget.icon, size: 15, color: fg),
          if (widget.label.isNotEmpty) const SizedBox(width: 7),
        ],
        if (widget.label.isNotEmpty) Flexible(child: label),
      ],
    );

    final pressed = enabled && _down;
    Widget button = AnimatedScale(
      scale: pressed ? 0.985 : 1,
      duration: const Duration(milliseconds: 120),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        // Pressing pushes the key down into the page; hovering lifts it.
        transform: Matrix4.translationValues(0, pressed ? 1.5 : (hot && solid ? -1 : 0), 0),
        padding:
            widget.padding ??
            (widget.small
                ? const EdgeInsets.symmetric(horizontal: 11, vertical: 8)
                : const EdgeInsets.symmetric(horizontal: 13, vertical: 10)),
        decoration: solid
            ? raised(radius: 10, top: top, bottom: bottom, lift: hot ? 0.5 : 0, pressed: pressed)
            : BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [top, bottom],
                ),
                border: Border.all(
                  color: widget.kind == BtnKind.ghost
                      ? Colors.transparent
                      : Colors.white.withValues(alpha: hot ? 0.5 : 0.22),
                ),
              ),
        child: content,
      ),
    );

    button = Opacity(opacity: enabled ? 1 : 0.45, child: button);
    button = MouseRegion(
      cursor: enabled ? SystemMouseCursors.click : SystemMouseCursors.forbidden,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() {
        _hover = false;
        _down = false;
      }),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: widget.onPressed,
        child: button,
      ),
    );
    button = Semantics(button: true, enabled: enabled, label: widget.tooltip ?? widget.label, child: button);
    return widget.tooltip == null ? button : Tooltip(message: widget.tooltip!, child: button);
  }
}

class LinkBtn extends StatelessWidget {
  const LinkBtn(this.label, {super.key, this.onPressed, this.size = 12});

  final String label;
  final VoidCallback? onPressed;
  final double size;

  @override
  Widget build(BuildContext context) => MouseRegion(
    cursor: onPressed == null ? SystemMouseCursors.basic : SystemMouseCursors.click,
    child: GestureDetector(
      onTap: onPressed,
      child: Opacity(
        opacity: onPressed == null ? 0.45 : 1,
        child: Text(
          label,
          style: t(
            size,
            color: C.accent,
            weight: FontWeight.w600,
          ).copyWith(decoration: TextDecoration.underline, decorationColor: C.accent),
        ),
      ),
    ),
  );
}

/// The small square button that closes a dialog or removes a row.
class XButton extends StatefulWidget {
  const XButton({super.key, required this.onPressed, this.size = 30, this.danger = false, this.tooltip});

  final VoidCallback? onPressed;
  final double size;

  /// Turns red on hover, for the ones that delete something.
  final bool danger;
  final String? tooltip;

  @override
  State<XButton> createState() => _XButtonState();
}

class _XButtonState extends State<XButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final hot = _hover && widget.onPressed != null;
    final color = hot ? (widget.danger ? C.red : C.ink) : (widget.danger ? C.muted : C.dim);
    final box = MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: widget.onPressed,
        child: Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: widget.danger ? (hot ? C.red.withValues(alpha: 0.08) : Colors.transparent) : C.card2,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: widget.danger ? (hot ? C.red.withValues(alpha: 0.4) : C.line2) : C.line),
          ),
          child: Icon(Icons.close, size: widget.size * 0.5, color: color),
        ),
      ),
    );
    return widget.tooltip == null ? box : Tooltip(message: widget.tooltip!, child: box);
  }
}

/// The pill inside a field that fills it in: "Now", "Today", "Show".
class FieldPill extends StatelessWidget {
  const FieldPill(this.label, {super.key, this.icon, required this.onPressed});

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 6),
    child: MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onPressed,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
          decoration: BoxDecoration(
            color: C.accent.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: C.accent.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: 12, color: C.accent), const SizedBox(width: 4)],
              Text(
                label,
                style: t(10.5, color: C.accent, weight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------- fields */

class AppSelect<T> extends StatelessWidget {
  const AppSelect({super.key, required this.value, required this.items, required this.onChanged});

  final T value;
  final List<(T, String)> items;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(
      color: C.well,
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: C.line),
    ),
    child: DropdownButtonHideUnderline(
      child: DropdownButton<T>(
        value: value,
        isExpanded: true,
        isDense: false,
        dropdownColor: C.card,
        borderRadius: BorderRadius.circular(10),
        icon: const Icon(Icons.expand_more, size: 18, color: C.muted),
        style: t(13),
        items: [
          for (final (v, label) in items)
            DropdownMenuItem(
              value: v,
              child: Text(label, overflow: TextOverflow.ellipsis, style: t(13)),
            ),
        ],
        onChanged: (v) {
          if (v != null) onChanged(v);
        },
      ),
    ),
  );
}

/// Keeps a time to `HH:MM` as it is typed: digits only, colon put in for you.
class _TimeFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    var digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length > 4) digits = digits.substring(0, 4);
    // "9:" typed by hand means nine o'clock, not the start of ninety-something.
    if (RegExp(r'^\d:').hasMatch(newValue.text) && digits.isNotEmpty) digits = '0$digits';
    if (digits.length > 4) digits = digits.substring(0, 4);
    final text = digits.length <= 2 ? digits : '${digits.substring(0, 2)}:${digits.substring(2)}';
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}

/// A 24-hour `HH:MM` field. Typed directly, or picked from the clock.
class TimeField extends StatefulWidget {
  const TimeField({
    super.key,
    required this.value,
    required this.onChanged,
    this.dense = false,
    this.showNow = false,
    this.autofocus = false,
    this.onSubmitted,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final bool dense;

  /// Offers a "Now" pill while the field is empty.
  final bool showNow;
  final bool autofocus;
  final VoidCallback? onSubmitted;

  @override
  State<TimeField> createState() => _TimeFieldState();
}

class _TimeFieldState extends State<TimeField> {
  late final _text = TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(TimeField old) {
    super.didUpdateWidget(old);
    // Only an outside change is pushed in; echoing the user's own typing back
    // would fight the cursor.
    if (widget.value != _text.text) _text.text = widget.value;
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final mins = minutesFromInput(_text.text) ?? minutesFromInput(inputTimeNow()) ?? 0;
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: mins ~/ 60, minute: mins % 60),
      builder: (context, child) =>
          MediaQuery(data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true), child: child!),
    );
    if (picked != null) widget.onChanged('${p2(picked.hour)}:${p2(picked.minute)}');
  }

  @override
  Widget build(BuildContext context) => TextField(
    controller: _text,
    autofocus: widget.autofocus,
    keyboardType: TextInputType.datetime,
    inputFormatters: [_TimeFormatter()],
    style: m(widget.dense ? 12 : 13),
    onChanged: widget.onChanged,
    onSubmitted: (_) => widget.onSubmitted?.call(),
    decoration: inputDecoration(
      hint: '--:--',
      padding: widget.dense ? const EdgeInsets.symmetric(horizontal: 9, vertical: 10) : null,
      suffix: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.showNow && widget.value.trim().isEmpty)
            FieldPill(
              'Now',
              icon: widget.dense ? null : Icons.schedule,
              onPressed: () => widget.onChanged(inputTimeNow()),
            )
          else
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: IconButton(
                onPressed: _pick,
                tooltip: 'Pick a time',
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                icon: const Icon(Icons.schedule, size: 15, color: C.muted),
              ),
            ),
        ],
      ),
    ),
  );
}

/// A `YYYY-MM-DD` field that opens a calendar.
class DateField extends StatelessWidget {
  const DateField({
    super.key,
    required this.value,
    required this.onChanged,
    this.min,
    this.max,
    this.dense = false,
    this.trailing,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final String? min;
  final String? max;
  final bool dense;
  final Widget? trailing;

  static DateTime? _parse(String? key) => key == null ? null : DateTime.tryParse(key);

  Future<void> _pick(BuildContext context) async {
    final first = _parse(min) ?? DateTime(2000);
    final last = _parse(max) ?? DateTime(2100);
    var initial = _parse(value) ?? DateTime.now();
    if (initial.isBefore(first)) initial = first;
    if (initial.isAfter(last)) initial = last;
    final picked = await showDatePicker(context: context, initialDate: initial, firstDate: first, lastDate: last);
    if (picked != null) onChanged('${picked.year}-${p2(picked.month)}-${p2(picked.day)}');
  }

  @override
  Widget build(BuildContext context) => MouseRegion(
    cursor: SystemMouseCursors.click,
    child: GestureDetector(
      onTap: () => _pick(context),
      child: Container(
        padding: EdgeInsets.only(left: dense ? 10 : 12, top: dense ? 5 : 7, bottom: dense ? 5 : 7),
        decoration: BoxDecoration(
          color: C.well,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: C.line),
        ),
        child: Row(
          children: [
            Expanded(child: Text(value.isEmpty ? 'yyyy-mm-dd' : value, style: m(dense ? 12 : 13))),
            trailing ??
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  child: Icon(Icons.calendar_today_outlined, size: 14, color: C.muted),
                ),
          ],
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------- dialog */

/// Shows `builder` as the app's modal: blurred scrim, springy entrance.
Future<T?> showModal<T>(BuildContext context, {required WidgetBuilder builder, bool dismissible = true}) =>
    showGeneralDialog<T>(
      context: context,
      barrierDismissible: dismissible,
      barrierLabel: 'Close',
      barrierColor: const Color(0xBD040406),
      transitionDuration: const Duration(milliseconds: 240),
      pageBuilder: (context, _, _) => builder(context),
      transitionBuilder: (context, animation, _, child) {
        final v = CurvedAnimation(parent: animation, curve: Curves.easeOutBack, reverseCurve: Curves.easeIn);
        return BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 6 * animation.value, sigmaY: 6 * animation.value),
          child: FadeTransition(
            opacity: animation,
            child: Transform.translate(
              offset: Offset(0, 26 * (1 - v.value)),
              child: Transform.scale(scale: 0.96 + 0.04 * v.value, child: child),
            ),
          ),
        );
      },
    );

class ModalShell extends StatelessWidget {
  const ModalShell({
    super.key,
    required this.icon,
    required this.tone,
    required this.title,
    required this.subtitle,
    required this.body,
    required this.actions,
    this.wide = false,
    this.onClose,
  });

  final IconData icon;
  final TileTone tone;
  final String title;
  final String subtitle;
  final List<Widget> body;

  /// Laid out left to right; the last one is the primary action and gets more room.
  final List<Widget> actions;
  final bool wide;

  /// Null while the dialog must not be closed — mid sign-in, say.
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: wide ? 620 : 430),
          child: Material(
            color: C.card,
            elevation: 30,
            shadowColor: Colors.black,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(18),
              side: const BorderSide(color: C.line),
            ),
            clipBehavior: Clip.antiAlias,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      IconTile(icon, tone: tone),
                      const SizedBox(width: 13),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(title, style: t(16, weight: FontWeight.w600)),
                            const SizedBox(height: 4),
                            Text(subtitle, style: t(12, color: C.muted, height: 1.5)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 13),
                      XButton(onPressed: onClose, tooltip: 'Close'),
                    ],
                  ),
                  const SizedBox(height: 18),
                  ...body,
                  const SizedBox(height: 26),
                  Row(
                    children: [
                      for (final (i, action) in actions.indexed) ...[
                        if (i > 0) const SizedBox(width: 10),
                        Expanded(flex: i == actions.length - 1 ? 14 : 10, child: action),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
