/// Thrown by `scriptGet`. `kind` is `timeout` or `network`.
class ScriptFailure implements Exception {
  const ScriptFailure(this.kind);

  final String kind;
}
