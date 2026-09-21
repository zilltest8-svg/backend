import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'state/app_state.dart';
import 'ui/layout.dart';
import 'ui/shell.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(ZilTimeApp(state: AppState(prefs)));
}

class ZilTimeApp extends StatelessWidget {
  const ZilTimeApp({super.key, required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) => AppScope(
    // Above the navigator, so dialogs read the same state the pages do.
    state: state,
    child: MaterialApp(title: 'Zil Time', debugShowCheckedModeBanner: false, theme: buildTheme(), home: const Shell()),
  );
}
