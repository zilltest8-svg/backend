import 'package:flutter/material.dart';

import '../state/app_state.dart';

/// Hands the app state to everything below it, and rebuilds it on every change.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);

  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;

  /// For callbacks, which need the state but must not subscribe to it.
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

/// The dashboard's two columns: the main one flexes, the side one is fixed, and
/// on anything narrow they stack.
class Cols extends StatelessWidget {
  const Cols({super.key, required this.main, required this.side});

  final Widget main;
  final Widget side;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) => box.maxWidth >= 730
        ? Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: main),
              const SizedBox(width: 16),
              SizedBox(width: 320, child: side),
            ],
          )
        : Column(children: [main, const SizedBox(height: 16), side]),
  );
}

/// CSS `repeat(auto-fit, minmax(min, 1fr))`: as many equal columns as will fit.
class AutoGrid extends StatelessWidget {
  const AutoGrid({super.key, required this.minWidth, required this.children, this.gap = 14});

  final double minWidth;
  final double gap;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      if (children.isEmpty) return const SizedBox.shrink();
      final fit = ((box.maxWidth + gap) / (minWidth + gap)).floor().clamp(1, children.length);
      final width = (box.maxWidth - gap * (fit - 1)) / fit;
      return Wrap(
        spacing: gap,
        runSpacing: gap,
        children: [for (final child in children) SizedBox(width: width.floorToDouble(), child: child)],
      );
    },
  );
}

/// A vertical stack with the app's standard 16px gap.
class Gap extends StatelessWidget {
  const Gap({super.key, required this.children, this.gap = 16});

  final List<Widget> children;
  final double gap;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final (i, child) in children.indexed) ...[if (i > 0) SizedBox(height: gap), child],
    ],
  );
}
