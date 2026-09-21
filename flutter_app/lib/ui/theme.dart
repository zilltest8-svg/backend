import 'package:flutter/material.dart';

/// The palette: black, white and the greys between. The names are the roles the
/// colours once had — `green` is "good / work", `amber` is "break / caution" —
/// so the meaning survives even though the hue is gone: work is white, a break
/// is mid-grey, and depth rather than colour does the rest.
abstract final class C {
  static const bg = Color(0xFF050505);
  static const panel = Color(0xFF0A0A0A);
  static const card = Color(0xFF131313);
  static const card2 = Color(0xFF1B1B1B);
  static const raised = Color(0xFF2B2B2B);
  static const line = Color(0xFF2A2A2A);
  static const line2 = Color(0xFF1E1E1E);
  static const ink = Color(0xFFFFFFFF);
  static const dim = Color(0xFFA8A8A8);
  static const muted = Color(0xFF6E6E6E);
  static const green = Color(0xFFFFFFFF);
  static const amber = Color(0xFF9C9C9C);
  static const violet = Color(0xFFE6E6E6);
  static const blue = Color(0xFFCFCFCF);
  static const red = Color(0xFFD9D9D9);
  static const accent = Color(0xFFFFFFFF);
  static const onAccent = Color(0xFF000000);
  static const well = Color(0xFF070707);
  static const code = Color(0xFFD0D0D0);
}

/// A surface that stands off the page: lit from above, so it is lighter at the
/// top, carries a hairline of light along its upper edge, and throws a shadow
/// below. `lift` raises it further (hover); `pressed` pushes it in.
BoxDecoration raised({
  double radius = 16,
  Color top = const Color(0xFF1E1E1E),
  Color bottom = const Color(0xFF0D0D0D),
  double lift = 0,
  bool pressed = false,
  Color? edge,
}) => BoxDecoration(
  borderRadius: BorderRadius.circular(radius),
  gradient: LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: pressed ? [bottom, top] : [top, bottom],
  ),
  border: Border.all(color: edge ?? Colors.white.withValues(alpha: 0.07 + 0.05 * lift)),
  boxShadow: pressed
      ? const [BoxShadow(color: Color(0xCC000000), blurRadius: 2, offset: Offset(0, 1))]
      : [
          // the light catching the top edge
          BoxShadow(
            color: Colors.white.withValues(alpha: 0.10 + 0.06 * lift),
            offset: const Offset(0, -1),
          ),
          // a tight contact shadow, then the soft one that gives the height
          const BoxShadow(color: Color(0xE6000000), blurRadius: 3, offset: Offset(0, 2)),
          BoxShadow(
            color: const Color(0xB3000000),
            blurRadius: 22 + 14 * lift,
            spreadRadius: -4,
            offset: Offset(0, 10 + 6 * lift),
          ),
        ],
);

/// The opposite: a well cut into the surface, for tracks and input fields.
BoxDecoration sunken({double radius = 10}) => BoxDecoration(
  borderRadius: BorderRadius.circular(radius),
  gradient: const LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF030303), Color(0xFF0E0E0E)],
  ),
  border: Border.all(color: Colors.black),
  boxShadow: [BoxShadow(color: Colors.white.withValues(alpha: 0.06), offset: const Offset(0, 1))],
);

/// The easing every entrance in the app shares.
const ease = Cubic(0.22, 1, 0.36, 1);

const _tabular = [FontFeature.tabularFigures()];

/// Numbers that tick must not jitter sideways as their digits change.
const mono = TextStyle(
  fontFamily: 'Consolas',
  fontFamilyFallback: ['Menlo', 'Courier New', 'monospace'],
  fontFeatures: _tabular,
);

TextStyle t(double size, {Color color = C.ink, FontWeight weight = FontWeight.w400, double? spacing, double? height}) =>
    TextStyle(
      fontSize: size,
      color: color,
      fontWeight: weight,
      letterSpacing: spacing,
      height: height,
      fontFeatures: _tabular,
    );

TextStyle m(double size, {Color color = C.ink, FontWeight weight = FontWeight.w400, double? spacing}) =>
    mono.copyWith(fontSize: size, color: color, fontWeight: weight, letterSpacing: spacing);

ThemeData buildTheme() {
  final base = ThemeData(
    brightness: Brightness.dark,
    useMaterial3: true,
    colorScheme: const ColorScheme.dark(
      primary: C.accent,
      onPrimary: C.onAccent,
      surface: C.card,
      onSurface: C.ink,
      error: C.red,
    ),
  );
  return base.copyWith(
    scaffoldBackgroundColor: C.bg,
    textTheme: base.textTheme.apply(bodyColor: C.ink, displayColor: C.ink),
    textSelectionTheme: const TextSelectionThemeData(cursorColor: C.accent, selectionColor: Color(0x55FFFFFF)),
    scrollbarTheme: ScrollbarThemeData(
      thickness: const WidgetStatePropertyAll(6),
      radius: const Radius.circular(3),
      thumbColor: const WidgetStatePropertyAll(Color(0xFF33333B)),
    ),
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 500),
      decoration: BoxDecoration(
        color: C.card2,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: C.line),
      ),
      textStyle: t(11.5, color: C.dim),
    ),
  );
}

InputDecoration inputDecoration({String? hint, EdgeInsets? padding, Widget? suffix}) {
  OutlineInputBorder border(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(10),
    borderSide: BorderSide(color: color),
  );
  return InputDecoration(
    isDense: true,
    filled: true,
    fillColor: C.well,
    hintText: hint,
    hintStyle: m(13, color: C.muted),
    contentPadding: padding ?? const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
    suffixIcon: suffix,
    suffixIconConstraints: const BoxConstraints(),
    enabledBorder: border(C.line),
    disabledBorder: border(C.line2),
    focusedBorder: border(const Color(0xFF43434E)),
  );
}
