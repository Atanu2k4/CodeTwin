import 'package:flutter/material.dart';

/// CLI colour theme (dynamic by level)
class CliTheme extends InheritedWidget {
  final int level;

  const CliTheme({
    super.key,
    required this.level,
    required super.child,
  });

  static CliTheme of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<CliTheme>()!;

  @override
  bool updateShouldNotify(CliTheme old) => level != old.level;

  Color get bg => switch (level) {
        1 => const Color(0xFF070D07),
        2 => const Color(0xFF070D0D),
        3 => const Color(0xFF070A0D),
        4 => const Color(0xFF0D0A07),
        _ => const Color(0xFF0D0707),
      };
  Color get surface => switch (level) {
        1 => const Color(0xFF0D1A0D),
        2 => const Color(0xFF0D1A1A),
        3 => const Color(0xFF0D131A),
        4 => const Color(0xFF1A130D),
        _ => const Color(0xFF1A0D0D),
      };
  Color get accent => switch (level) {
        1 => const Color(0xFF00FF41),
        2 => const Color(0xFF00E5FF),
        3 => const Color(0xFF2979FF),
        4 => const Color(0xFFFF9100),
        _ => const Color(0xFFFF3131),
      };
  Color get accentDim => switch (level) {
        1 => const Color(0xFF00C132),
        2 => const Color(0xFF00B8D4),
        3 => const Color(0xFF2962FF),
        4 => const Color(0xFFFF6D00),
        _ => const Color(0xFFD50000),
      };
  Color get accentMuted => switch (level) {
        1 => const Color(0xFF1A3D1A),
        2 => const Color(0xFF1A3D3D),
        3 => const Color(0xFF1A2B3D),
        4 => const Color(0xFF3D2B1A),
        _ => const Color(0xFF3D1A1A),
      };

  final Color cyan = const Color(0xFF00E5FF);
  final Color amber = const Color(0xFFFFB300);
  final Color red = const Color(0xFFFF3131);
  final Color redMuted = const Color(0xFF3D0A0A);
  final Color text = const Color(0xFFCCFFCC);
  final Color textDim = const Color(0xFF557755);
  final Color border = const Color(0xFF1F3D1F);
  final Color borderBright = const Color(0xFF00FF41);
  final TextStyle mono = const TextStyle(fontFamily: 'monospace');

  BoxDecoration box({Color? borderColor, Color? bgColor, double radius = 4}) =>
      BoxDecoration(
        color: bgColor ?? surface,
        border: Border.all(color: borderColor ?? border, width: 1),
        borderRadius: BorderRadius.circular(radius),
      );
}
