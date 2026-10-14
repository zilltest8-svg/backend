import 'package:flutter/material.dart';

import '../core/health_rule.dart';
import 'theme.dart';

/// A health reminder in full — what to do and why — in rising strength, the
/// punch-out inverted to white so it cannot be missed. The banner across the
/// top of every screen.
class HealthNote extends StatelessWidget {
  const HealthNote(this.alert, {super.key, this.trailing});

  final HealthAlert alert;

  /// A button at the end of the note, for the banner's Dismiss.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final stop = alert.tone == HealthTone.stop;
    final (Color bg, Color edge) = switch (alert.tone) {
      HealthTone.info => (Colors.white.withValues(alpha: 0.05), Colors.white.withValues(alpha: 0.16)),
      HealthTone.warn => (Colors.white.withValues(alpha: 0.08), Colors.white.withValues(alpha: 0.28)),
      HealthTone.strong => (Colors.white.withValues(alpha: 0.12), Colors.white.withValues(alpha: 0.5)),
      HealthTone.stop => (C.ink, C.ink),
    };
    final title = stop ? Colors.black : C.ink;
    final body = stop ? Colors.black.withValues(alpha: 0.78) : C.dim;
    final why = stop ? Colors.black.withValues(alpha: 0.6) : C.muted;

    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(alert.title, style: t(13, color: title, weight: FontWeight.w600)),
        const SizedBox(height: 5),
        Text(alert.message, style: t(12.5, color: body, height: 1.6)),
        const SizedBox(height: 5),
        Text(alert.why, style: t(11.5, color: why, height: 1.55)),
      ],
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12), border: Border.all(color: edge)),
      child: trailing == null
          ? text
          : Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [Expanded(child: text), const SizedBox(width: 12), trailing!],
            ),
    );
  }
}
