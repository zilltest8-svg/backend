import 'package:cloud_firestore/cloud_firestore.dart' show FirebaseFirestore, Settings;
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'firebase_options.dart';
import 'state/app_state.dart';
import 'state/cloud_history.dart';
import 'ui/layout.dart';
import 'ui/shell.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Firebase and local storage come up side by side rather than one after the
  // other, and a Firebase that fails to start does not keep the app from
  // starting — history then stays on this device until the next launch.
  final results = await Future.wait([SharedPreferences.getInstance(), _cloud()]);
  final prefs = results[0] as SharedPreferences;
  runApp(ZilTimeApp(state: AppState(prefs, cloud: results[1] as CloudHistory?)));
}

Future<CloudHistory?> _cloud() async {
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    final db = FirebaseFirestore.instance;
    // Keep a copy on disk: the first snapshot then comes from the cache in a few
    // milliseconds, and the server's answer follows once it arrives.
    db.settings = const Settings(persistenceEnabled: true);
    return CloudHistory(db);
  } catch (e) {
    debugPrint('Firebase unavailable: $e');
    return null;
  }
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
  //sdfsad
}
