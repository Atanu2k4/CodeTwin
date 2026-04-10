import 'package:flutter/material.dart';
import '../constants/levels.dart';

class LevelPicker extends StatelessWidget {
  final int currentLevel;
  final ValueChanged<int> onChanged;
  final bool showDetails;

  const LevelPicker({
    super.key,
    required this.currentLevel,
    required this.onChanged,
    this.showDetails = true,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final info = getDependenceLevel(currentLevel);
    
    const double tabHeight = 44.0;
    const int totalLevels = 5;

    // Remove glow colors entirely. Use clean tasteful flat colors.
    final Color bgColor = switch(currentLevel) {
      1 => Colors.green.shade700,
      2 => Colors.teal.shade600,
      3 => Colors.blue.shade600,
      4 => Colors.orange.shade700,
      _ => Colors.red.shade700,
    };

    return Center(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            height: tabHeight,
            constraints: const BoxConstraints(maxWidth: 280), // Caps total width gracefully
            decoration: BoxDecoration(
              color: const Color(0xFF1C1C21),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
            ),
            child: Stack(
              children: [
                // Absolute bulletproof sliding pill using native alignment factors
                AnimatedAlign(
                  duration: const Duration(milliseconds: 300),
                  curve: Curves.fastOutSlowIn,
                  alignment: Alignment(-1.0 + (currentLevel - 1) * 0.5, 0.0), // -1 to +1 range for 5 items (step is 0.5)
                  child: FractionallySizedBox(
                    widthFactor: 1.0 / totalLevels,
                    heightFactor: 1.0,
                    child: Container(
                      decoration: BoxDecoration(
                        color: bgColor,
                        borderRadius: BorderRadius.circular(22),
                      ),
                    ),
                  ),
                ),
                // Expanded touch areas guarantee it perfectly fills the container to the atomic level
                Row(
                  children: List.generate(totalLevels, (i) {
                    final level = i + 1;
                    final isSelected = currentLevel == level;
                    return Expanded(
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () => onChanged(level),
                        child: Center(
                          child: AnimatedDefaultTextStyle(
                            duration: const Duration(milliseconds: 200),
                            style: TextStyle(
                              fontSize: isSelected ? 16 : 15,
                              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                              color: isSelected ? Colors.white : Colors.white.withValues(alpha: 0.5),
                            ),
                            child: Text('$level'),
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ],
            ),
          ),
          if (showDetails) ...[
            const SizedBox(height: 16),
            // Fix text overlap using custom layoutbuilder and fast transition
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 150),
              reverseDuration: const Duration(milliseconds: 100),
              layoutBuilder: (currentChild, previousChildren) {
                // This guarantees only one renders in stack or centers properly
                return Stack(
                  alignment: Alignment.topCenter,
                  children: <Widget>[
                    ...previousChildren,
                    if (currentChild != null) currentChild,
                  ],
                );
              },
              transitionBuilder: (child, animation) {
                return FadeTransition(opacity: animation, child: child);
              },
              child: Column(
                key: ValueKey<int>(currentLevel),
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Text(
                    info.name.toUpperCase(),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: 2.0,
                      color: bgColor,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    info.description,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.8),
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
