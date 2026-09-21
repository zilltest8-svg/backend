/// The animated pieces the React version drew with three.js, redrawn in 2D.
/// Each one keeps what the original was for — the ring fills to the progress,
/// the thread says time is moving, the bars compare days — without the WebGL.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../core/history.dart';
import '../core/time.dart';
import 'theme.dart';

/// What the day is doing, which is what every visual is tinted by.
enum DayTone { idle, working, onBreak, done }

/// Frame-rate independent easing towards a target.
double approach(double current, double target, double dt, double rate) =>
    current + (target - current) * (1 - math.exp(-rate * dt));

/// Drives a painter from a ticker: `advance` moves the state, then it repaints.
abstract class _Animated<T extends StatefulWidget> extends State<T> with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  final _frame = ValueNotifier(0);
  Duration _last = Duration.zero;
  double elapsed = 0;

  void advance(double dt);

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((now) {
      final dt = math.min(0.1, (now - _last).inMicroseconds / 1e6);
      _last = now;
      elapsed += dt;
      advance(dt);
      _frame.value++;
    })..start();
  }

  @override
  void dispose() {
    _ticker.dispose();
    _frame.dispose();
    super.dispose();
  }
}

/* --------------------------------------------------------------------- logo */

/// The mark: an open ring with the tip left bright, and a pair of hands inside.
class Logo extends StatelessWidget {
  const Logo({super.key, this.size = 22, this.live = false});

  final double size;

  /// True while a session is running — the tip pulses, as the timer ring does.
  final bool live;

  @override
  Widget build(BuildContext context) => _LogoPulse(key: ValueKey(live), size: size, live: live);
}

class _LogoPulse extends StatefulWidget {
  const _LogoPulse({super.key, required this.size, required this.live});

  final double size;
  final bool live;

  @override
  State<_LogoPulse> createState() => _LogoPulseState();
}

class _LogoPulseState extends State<_LogoPulse> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200));

  @override
  void initState() {
    super.initState();
    if (widget.live) _c.repeat(reverse: true);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: Size.square(widget.size),
    painter: _LogoPainter(CurvedAnimation(parent: _c, curve: ease)),
  );
}

class _LogoPainter extends CustomPainter {
  _LogoPainter(this.pulse) : super(repaint: pulse);

  final Animation<double> pulse;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 32);
    const centre = Offset(16, 16);

    // The ring, opened at the top-left so the tip reads as "now".
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.2
      ..strokeCap = StrokeCap.round
      ..shader = const LinearGradient(
        begin: Alignment(-0.62, -0.87),
        end: Alignment(0.62, 0.87),
        colors: [Colors.white, Color(0xFFBDBDBD), Color(0xFF6E6E6E)],
        stops: [0, 0.55, 1],
      ).createShader(const Rect.fromLTWH(0, 0, 32, 32));
    canvas.drawArc(Rect.fromCircle(center: centre, radius: 11.5), -math.pi / 2, math.pi * 1.75, false, ring);

    final v = pulse.value;
    canvas.drawCircle(
      const Offset(16, 4.5),
      2.9 * (1 - 0.18 * v),
      Paint()..color = C.accent.withValues(alpha: 1 - 0.45 * v),
    );

    final hand = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..color = C.ink;
    canvas.drawLine(const Offset(16, 16.5), const Offset(16, 11), hand);
    canvas.drawLine(const Offset(16, 16.5), const Offset(20.1, 19), hand..color = C.ink.withValues(alpha: 0.75));
  }

  @override
  bool shouldRepaint(_LogoPainter old) => false;
}

/* --------------------------------------------------------------- timer ring */

const _ringTone = {DayTone.idle: C.muted, DayTone.working: C.ink, DayTone.onBreak: C.amber, DayTone.done: C.green};

/// Progress around a clock face, clockwise from twelve, with a head riding the
/// end of the arc so it is readable at a glance.
class TimerRing extends StatefulWidget {
  const TimerRing({super.key, required this.value, required this.tone, required this.live, this.size = 132});

  /// 0..1 around the ring.
  final double value;
  final DayTone tone;

  /// True while the day is still running — drives the pulse.
  final bool live;
  final double size;

  @override
  State<TimerRing> createState() => _TimerRingState();
}

class _TimerRingState extends _Animated<TimerRing> {
  double _shown = 0;
  double _pulse = 0;
  Color _colour = C.muted;

  @override
  void initState() {
    super.initState();
    _colour = _ringTone[widget.tone]!;
  }

  @override
  void advance(double dt) {
    _shown = approach(_shown, widget.value.clamp(0, 1).toDouble(), dt, 3.5);
    _colour = Color.lerp(_colour, _ringTone[widget.tone], 1 - math.exp(-4 * dt))!;
    _pulse = approach(_pulse, widget.live ? 0.5 + 0.5 * math.sin(elapsed * 2.2) : 0, dt, 8);
  }

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: widget.size,
    child: Stack(
      alignment: Alignment.center,
      children: [
        Positioned.fill(
          child: RepaintBoundary(child: CustomPaint(painter: _RingPainter(this, _frame))),
        ),
        Container(
          width: 46,
          height: 46,
          decoration: raised(radius: 23, top: const Color(0xFF2A2A2A), bottom: const Color(0xFF101010)),
          child: const Icon(Icons.schedule, size: 20, color: C.dim),
        ),
      ],
    ),
  );
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.state, Listenable repaint) : super(repaint: repaint);

  final _TimerRingState state;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final stroke = size.width * 0.085;
    final radius = size.width / 2 - stroke * 1.3;
    final colour = state._colour;
    final pulse = state._pulse;

    final rect = Rect.fromCircle(center: centre, radius: radius);
    Paint ring(double width) => Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..strokeCap = StrokeCap.round;

    // The groove: dark, darker still along its upper lip where the light from
    // above cannot reach, and catching a little of it along the lower one.
    canvas.drawCircle(centre, radius, ring(stroke)..color = const Color(0xFF0B0B0B));
    canvas.drawCircle(
      centre.translate(0, 1.2),
      radius,
      ring(stroke)
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x00FFFFFF), Color(0x24FFFFFF)],
        ).createShader(rect),
    );
    canvas.drawCircle(centre, radius, ring(stroke * 0.86)..color = const Color(0xFF070707));

    final shown = state._shown;
    if (shown <= 0.004) return;
    final sweep = shown * math.pi * 2;
    const start = -math.pi / 2;

    // The tube's shadow on the floor of the groove, then the tube itself: a
    // wide grey body with a narrow highlight along its crown makes it round.
    canvas.drawArc(
      rect.translate(0, 3),
      start,
      sweep,
      false,
      ring(stroke * 0.8)
        ..color = Colors.black.withValues(alpha: 0.7)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4),
    );
    canvas.drawArc(rect, start, sweep, false, ring(stroke * 0.8)..color = Color.lerp(colour, Colors.black, 0.45)!);
    canvas.drawArc(
      rect.deflate(-stroke * 0.06),
      start,
      sweep,
      false,
      ring(stroke * 0.52)..color = Color.lerp(colour, Colors.black, 0.12)!,
    );
    canvas.drawArc(
      rect.deflate(-stroke * 0.16),
      start,
      sweep,
      false,
      ring(stroke * 0.16)
        ..color = colour.withValues(alpha: 0.95)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 0.6 + pulse * 1.6),
    );

    final angle = -math.pi / 2 + sweep;
    final head = centre + Offset(math.cos(angle), math.sin(angle)) * radius;
    final r = stroke * 0.62 * (1 + pulse * 0.2);
    // A bead at the end of the tube, shaded as a sphere lit from the upper left.
    canvas.drawCircle(
      head.translate(0, 2.5),
      r,
      Paint()
        ..color = Colors.black.withValues(alpha: 0.6)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3),
    );
    canvas.drawCircle(
      head,
      r,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(-0.4, -0.5),
          colors: [Colors.white, colour, Color.lerp(colour, Colors.black, 0.6)!],
          stops: const [0, 0.45, 1],
        ).createShader(Rect.fromCircle(center: head, radius: r)),
    );
  }

  @override
  bool shouldRepaint(_RingPainter old) => false;
}

/* ------------------------------------------------------------------ counter */

/// `7:32:09`, each place sliding up as it changes.
class Counter extends StatelessWidget {
  const Counter({super.key, required this.parts, required this.done});

  final List<String> parts;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final style = m(40, color: done ? C.green : C.ink, weight: FontWeight.w600, spacing: -1.5);
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        for (final (i, part) in parts.indexed) ...[
          if (i > 0)
            Text(
              ':',
              style: style.copyWith(fontWeight: FontWeight.w400, color: style.color!.withValues(alpha: 0.5)),
            ),
          ClipRect(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 260),
              switchInCurve: ease,
              transitionBuilder: (child, animation) => SlideTransition(
                position: Tween(begin: const Offset(0, 0.35), end: Offset.zero).animate(animation),
                child: FadeTransition(opacity: animation, child: child),
              ),
              child: Text(part, key: ValueKey(part), style: style),
            ),
          ),
        ],
      ],
    );
  }
}

/* -------------------------------------------------------------------- donut */

/// Donut that draws itself to the current percentage.
class Donut extends StatelessWidget {
  const Donut({super.key, required this.value, this.size = 78});

  final double value;
  final double size;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: value.clamp(0, 1).toDouble()),
    duration: const Duration(milliseconds: 900),
    curve: ease,
    builder: (context, v, _) => CustomPaint(size: Size.square(size), painter: _DonutPainter(v)),
  );
}

class _DonutPainter extends CustomPainter {
  const _DonutPainter(this.value);

  final double value;

  @override
  void paint(Canvas canvas, Size size) {
    final centre = size.center(Offset.zero);
    final radius = size.width * 32 / 78;
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 9 / 78
      ..color = C.raised;
    canvas.drawCircle(centre, radius, track);
    if (value <= 0) return;
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: radius),
      -math.pi / 2,
      value * math.pi * 2,
      false,
      track
        ..color = C.green
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(_DonutPainter old) => old.value != value;
}

/* ----------------------------------------------------------------- day bars */

/// Worked and break hours per stored day, as columns you can read at a glance.
class DayBars extends StatelessWidget {
  const DayBars({super.key, required this.days, required this.target, this.limit = 14});

  /// Newest first, as `buildHistory` returns them.
  final List<DayEntry> days;

  /// Minutes of work owed, drawn as the line across the chart.
  final int target;

  /// How many days to show, oldest on the left.
  final int limit;

  @override
  Widget build(BuildContext context) {
    final shown = days.take(limit).toList().reversed.toList();
    final work = [for (final d in shown) d.result.worked / (60 * kMin)];
    final brk = [for (final d in shown) d.result.breakMs / (60 * kMin)];

    return Column(
      children: [
        LayoutBuilder(
          builder: (context, box) => TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: const Duration(milliseconds: 900),
            curve: ease,
            builder: (context, grow, _) => CustomPaint(
              size: Size(box.maxWidth, box.maxWidth < 560 ? 200 : 260),
              painter: _BarsPainter(work: work, brk: brk, goal: target / 60, grow: grow),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final d in shown)
              Expanded(
                child: Tooltip(
                  message: '${hm(d.result.worked)} worked, ${hm(d.result.breakMs)} break',
                  child: Text(
                    dayMonth(d.at),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: m(shown.length > 9 ? 8.5 : 10, color: C.muted),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _BarsPainter extends CustomPainter {
  const _BarsPainter({required this.work, required this.brk, required this.goal, required this.grow});

  final List<double> work;
  final List<double> brk;
  final double goal;
  final double grow;

  @override
  void paint(Canvas canvas, Size size) {
    final peak = [10.0, goal + 1, ...work, ...brk].reduce(math.max);
    final perHour = (size.height - 8) / peak;
    double yOf(double hours) => size.height - hours * perHour;

    // One line every two hours, so a bar's height is countable.
    final grid = Paint()
      ..color = const Color(0xFF2A2A31)
      ..strokeWidth = 1;
    for (var h = 2.0; h <= peak; h += 2) {
      canvas.drawLine(Offset(0, yOf(h)), Offset(size.width, yOf(h)), grid);
    }
    canvas.drawLine(Offset(0, size.height - 0.5), Offset(size.width, size.height - 0.5), grid);

    final slot = size.width / math.max(1, work.length);
    final width = (slot * 0.3).clamp(6.0, 34.0);

    void bar(double centre, double hours, double w, Color color) {
      if (hours <= 0) return;
      final depth = w * 0.42;
      final left = centre - w / 2, right = centre + w / 2;
      final top = yOf(hours * grow), base = size.height - 1;
      Color shade(double k) => Color.lerp(color, Colors.black, k)!;

      // The shadow it throws to the right, along the floor.
      canvas.drawPath(
        Path()..addPolygon([
          Offset(right, base),
          Offset(right + depth * 2.2, base),
          Offset(right + depth * 2.2, base - depth * 0.9),
          Offset(right + depth, base - depth * 0.5),
        ], true),
        Paint()
          ..color = Colors.black.withValues(alpha: 0.55)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 5),
      );
      // The side, turned away from the light.
      canvas.drawPath(
        Path()..addPolygon([
          Offset(right, top),
          Offset(right + depth, top - depth * 0.5),
          Offset(right + depth, base - depth * 0.5),
          Offset(right, base),
        ], true),
        Paint()..color = shade(0.68),
      );
      // The top, which catches all of it.
      canvas.drawPath(
        Path()..addPolygon([
          Offset(left, top),
          Offset(left + depth, top - depth * 0.5),
          Offset(right + depth, top - depth * 0.5),
          Offset(right, top),
        ], true),
        Paint()..color = Color.lerp(color, Colors.white, 0.25)!,
      );
      // The face, falling into shade towards the floor.
      final face = Rect.fromLTRB(left, top, right, base);
      canvas.drawRect(
        face,
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [shade(0.12), shade(0.5)],
          ).createShader(face),
      );
    }

    for (var i = 0; i < work.length; i++) {
      final centre = slot * (i + 0.5);
      // Break beside work and in front of it: it is a much shorter bar, so
      // behind it would be lost.
      bar(centre - width * 0.45, work[i], width, C.green);
      bar(centre + width * 0.75, brk[i], width * 0.6, C.amber);
    }

    canvas.drawLine(
      Offset(0, yOf(goal)),
      Offset(size.width, yOf(goal)),
      Paint()
        ..color = Colors.white.withValues(alpha: 0.45)
        ..strokeWidth = 1,
    );
  }

  @override
  bool shouldRepaint(_BarsPainter old) =>
      old.grow != grow || old.goal != goal || !_same(old.work, work) || !_same(old.brk, brk);

  static bool _same(List<double> a, List<double> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}
