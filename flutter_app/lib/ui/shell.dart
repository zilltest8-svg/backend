import 'package:flutter/material.dart';

import '../core/time.dart';
import '../state/app_state.dart';
import '../state/attendance.dart';
import 'dashboard.dart';
import 'dialogs.dart';
import 'layout.dart';
import 'pages.dart';
import 'theme.dart';
import 'visuals.dart';
import 'widgets.dart';

const _nav = [
  (AppView.dashboard, 'Dashboard', Icons.grid_view_outlined),
  (AppView.insights, 'Insights', Icons.trending_up),
  (AppView.history, 'History', Icons.history),
  (AppView.export, 'Export', Icons.add_to_drive),
];

class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  bool _setupShowing = false;

  /// The connect dialog is asked for from several places — any button that
  /// needs a connection — so it is opened here, off the one flag they all set.
  void _followSetup(AppState app) {
    if (!app.sheet.setupOpen || _setupShowing) return;
    _setupShowing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      await showSheetSetup(context);
      _setupShowing = false;
      app.sheet.closeSetup();
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    _followSetup(app);
    final day = app.day;

    final page = switch (app.view) {
      AppView.dashboard => const DashboardPage(),
      AppView.insights => const InsightsPage(),
      AppView.history => const _Narrow(child: HistoryPage()),
      AppView.export => const _Narrow(child: ExportPage()),
      AppView.settings => const SettingsPage(),
    };

    final main = SingleChildScrollView(
      physics: const BouncingScrollPhysics(decelerationRate: ScrollDecelerationRate.fast),
      padding: const EdgeInsets.fromLTRB(22, 18, 22, 28),
      child: Gap(
        children: [
          _TopBar(app: app),
          // Browsing history on purpose isn't a problem to warn about — the banner
          // is only for data that went stale under you, and its Shift button would
          // drag a deliberately chosen old day onto today.
          Reveal(
            open: day.stale && day.first != null && !app.browsing,
            child: _StaleBanner(first: day.first, onShift: app.shiftSelectedToToday),
          ),
          // One screen fades and lifts in as the last fades out, instead of cutting.
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 320),
            reverseDuration: const Duration(milliseconds: 140),
            switchInCurve: ease,
            layoutBuilder: (current, previous) =>
                Stack(alignment: Alignment.topCenter, children: [...previous, ?current]),
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: SlideTransition(
                position: Tween(begin: const Offset(0, 0.015), end: Offset.zero).animate(animation),
                child: child,
              ),
            ),
            child: KeyedSubtree(key: ValueKey(app.view), child: page),
          ),
        ],
      ),
    );

    return Scaffold(
      body: Stack(
        children: [
          LayoutBuilder(
            builder: (context, box) => box.maxWidth > 860
                ? Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SizedBox(width: 224, child: _Sidebar(app: app, vertical: true)),
                      Expanded(child: main),
                    ],
                  )
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _Sidebar(app: app, vertical: false),
                      Expanded(child: main),
                    ],
                  ),
          ),
          _Toast(toast: app.toast),
        ],
      ),
    );
  }
}

class _Narrow extends StatelessWidget {
  const _Narrow({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.topLeft,
    child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 900), child: child),
  );
}

/* ------------------------------------------------------------------ sidebar */

class _Sidebar extends StatelessWidget {
  const _Sidebar({required this.app, required this.vertical});

  final AppState app;

  /// A column down the side, or a wrapping row across the top on narrow screens.
  final bool vertical;

  @override
  Widget build(BuildContext context) {
    final running = app.running;

    final brand = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: C.line),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF2A2A2A), Color(0xFF0E0E0E)],
            ),
          ),
          child: Logo(live: running),
        ),
        const SizedBox(width: 11),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Zil Time',
                overflow: TextOverflow.ellipsis,
                style: t(16, weight: FontWeight.w600, spacing: -0.2),
              ),
              Text(
                'Deep Work Mode',
                overflow: TextOverflow.ellipsis,
                style: t(11, color: C.muted),
              ),
            ],
          ),
        ),
      ],
    );

    final items = [
      for (final (view, label, icon) in _nav)
        _NavButton(label: label, icon: icon, on: app.view == view, fill: vertical, onTap: () => app.setView(view)),
    ];
    final settings = _NavButton(
      label: 'Settings',
      icon: Icons.settings_outlined,
      on: app.view == AppView.settings,
      fill: vertical,
      onTap: () => app.setView(AppView.settings),
    );
    final status = _SyncStatus(app: app, wide: vertical);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 18),
      decoration: BoxDecoration(
        color: C.panel,
        border: vertical
            ? const Border(right: BorderSide(color: C.line2))
            : const Border(bottom: BorderSide(color: C.line2)),
      ),
      child: vertical
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(padding: const EdgeInsets.fromLTRB(6, 4, 6, 18), child: brand),
                for (final item in items) Padding(padding: const EdgeInsets.only(bottom: 2), child: item),
                const Spacer(),
                settings,
                const SizedBox(height: 12),
                status,
              ],
            )
          : Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 4,
              runSpacing: 8,
              children: [
                Padding(padding: const EdgeInsets.only(right: 12), child: brand),
                ...items,
                settings,
                status,
              ],
            ),
    );
  }
}

class _NavButton extends StatefulWidget {
  const _NavButton({
    required this.label,
    required this.icon,
    required this.on,
    required this.fill,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool on;
  final bool fill;
  final VoidCallback onTap;

  @override
  State<_NavButton> createState() => _NavButtonState();
}

class _NavButtonState extends State<_NavButton> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final color = widget.on || _hover ? C.ink : C.dim;
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hover = true),
      onExit: (_) => setState(() => _hover = false),
      child: GestureDetector(
        onTap: widget.onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
          // The screen you are on is the key that stays pressed in.
          decoration: widget.on
              ? sunken()
              : BoxDecoration(
                  color: _hover ? Colors.white.withValues(alpha: 0.05) : Colors.transparent,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: Colors.transparent),
                ),
          child: Row(
            mainAxisSize: widget.fill ? MainAxisSize.max : MainAxisSize.min,
            children: [
              Icon(widget.icon, size: 17, color: color),
              const SizedBox(width: 11),
              Flexible(
                child: Text(
                  widget.label,
                  overflow: TextOverflow.ellipsis,
                  style: t(13.5, color: color, weight: widget.on ? FontWeight.w600 : FontWeight.w500),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Where the timer button used to be: punches now come from the HR API by
/// themselves, so what is worth a permanent place is whether that is working.
class _SyncStatus extends StatelessWidget {
  const _SyncStatus({required this.app, required this.wide});

  final AppState app;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final api = app.attendance;
    final signedIn = api.auth == AuthState.signedIn;
    final failed = signedIn && (api.error ?? api.syncError) != null;
    final color = !signedIn
        ? C.muted
        : failed
        ? C.amber
        : C.green;
    final title = !signedIn
        ? 'Not signed in'
        : failed
        ? 'Sync problem'
        : api.syncing || api.loading
        ? 'Syncing…'
        : 'Live sync on';
    final note = !signedIn
        ? 'Sign in on the dashboard'
        : api.fetchedAt == null
        ? 'every ${autoSync.inSeconds}s'
        : 'updated ${clockShort(api.fetchedAt)}';

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: signedIn ? 0.08 : 0.04),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: signedIn ? 0.28 : 0.2)),
      ),
      child: Row(
        mainAxisSize: wide ? MainAxisSize.max : MainAxisSize.min,
        children: [
          Pulse(on: signedIn && !failed, child: Dot(color, size: 8)),
          const SizedBox(width: 10),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  overflow: TextOverflow.ellipsis,
                  style: t(12.5, color: signedIn ? C.ink : C.dim, weight: FontWeight.w600),
                ),
                Text(
                  note,
                  overflow: TextOverflow.ellipsis,
                  style: t(10.5, color: C.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ top bar */

/// Just the day on screen, at the right-hand end.
class _TopBar extends StatelessWidget {
  const _TopBar({required this.app});

  final AppState app;

  @override
  Widget build(BuildContext context) {
    final viewing = app.day.first;
    return Row(
      children: [
        const Spacer(),
        // The day currently on screen.
        if (viewing != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: raised(radius: 10),
            child: Text.rich(
              TextSpan(
                text: app.day.stale ? 'Stored day  ' : 'Today  ',
                children: [
                  TextSpan(
                    text: '${shortDay(viewing)} ${dateLabel(viewing)}',
                    style: t(12, weight: FontWeight.w600),
                  ),
                ],
              ),
              style: t(12, color: C.dim),
            ),
          ),
      ],
    );
  }
}

class _StaleBanner extends StatelessWidget {
  const _StaleBanner({required this.first, required this.onShift});

  final int? first;
  final VoidCallback onShift;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    decoration: BoxDecoration(
      color: C.amber.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: C.amber.withValues(alpha: 0.22)),
    ),
    child: Row(
      children: [
        Expanded(
          child: Text(
            'This data is from ${first == null ? 'an earlier day' : dateLabel(first!)}, not today — the live timer is paused.',
            style: t(12.5, color: C.amber),
          ),
        ),
        const SizedBox(width: 12),
        MouseRegion(
          cursor: SystemMouseCursors.click,
          child: GestureDetector(
            onTap: onShift,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: C.amber.withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: C.amber.withValues(alpha: 0.4)),
              ),
              child: Text(
                'Shift to today',
                style: t(12, color: C.amber, weight: FontWeight.w600),
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

/* -------------------------------------------------------------------- toast */

class _Toast extends StatefulWidget {
  const _Toast({required this.toast});

  final ToastMsg? toast;

  @override
  State<_Toast> createState() => _ToastState();
}

class _ToastState extends State<_Toast> {
  /// Kept after the message is cleared, so there is something to fade out.
  ToastMsg? _last;

  @override
  Widget build(BuildContext context) {
    final showing = widget.toast != null;
    final toast = _last = widget.toast ?? _last;
    if (toast == null) return const SizedBox.shrink();
    final color = toast.ok ? C.green : C.red;

    return Positioned(
      left: 16,
      right: 16,
      bottom: 26,
      child: IgnorePointer(
        ignoring: !showing,
        child: AnimatedSlide(
          offset: showing ? Offset.zero : const Offset(0, 0.4),
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutBack,
          child: AnimatedOpacity(
            opacity: showing ? 1 : 0,
            duration: const Duration(milliseconds: 200),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: raised(
                    radius: 13,
                    top: const Color(0xFF262626),
                    bottom: const Color(0xFF121212),
                    lift: 1,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 20,
                        height: 20,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: color.withValues(alpha: 0.16), shape: BoxShape.circle),
                        child: Text(
                          toast.ok ? '✓' : '!',
                          style: t(12, color: color, weight: FontWeight.w700),
                        ),
                      ),
                      const SizedBox(width: 11),
                      Flexible(child: Text(toast.text, style: t(12.5))),
                      if (toast.actionHref case final href?) ...[
                        const SizedBox(width: 11),
                        LinkBtn('${toast.actionLabel ?? 'Open'} ↗', size: 12.5, onPressed: () => openLink(href)),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
