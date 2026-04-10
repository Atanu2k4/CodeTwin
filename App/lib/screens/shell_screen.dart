import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/session_provider.dart';
import '../widgets/daemon_status_bar.dart';

class SwipeableShellContainer extends StatefulWidget {
  final StatefulNavigationShell navigationShell;
  final List<Widget> children;

  const SwipeableShellContainer({
    super.key,
    required this.navigationShell,
    required this.children,
  });

  @override
  State<SwipeableShellContainer> createState() => _SwipeableShellContainerState();
}

class _SwipeableShellContainerState extends State<SwipeableShellContainer> {
  late PageController _pageController;

  @override
  void initState() {
    super.initState();
    _pageController = PageController(initialPage: widget.navigationShell.currentIndex);
  }

  @override
  void didUpdateWidget(covariant SwipeableShellContainer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.navigationShell.currentIndex != _pageController.page?.round()) {
      _pageController.animateToPage(
        widget.navigationShell.currentIndex,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeOutQuart,
      );
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PageView(
      controller: _pageController,
      physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
      onPageChanged: (index) {
        // Keeps router correctly synced with the physical swipe movement
        widget.navigationShell.goBranch(
          index,
          initialLocation: index == widget.navigationShell.currentIndex,
        );
      },
      children: widget.children,
    );
  }
}

class ShellScreen extends ConsumerWidget {
  final StatefulNavigationShell shell;

  const ShellScreen({super.key, required this.shell});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessionAsync = ref.watch(sessionProvider);
    final session = sessionAsync.valueOrNull;
    final int badgeCount = session == null
        ? 0
        : session.preflightQueue.length + session.decisionQueue.length;

    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(child: shell),
            const Positioned(
              bottom: 16,
              right: 16,
              child: DaemonStatusBar(),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: const Color(0xFF08080A), // Deep dark matching background
          indicatorColor: Colors.tealAccent.withValues(alpha: 0.15),
          labelTextStyle: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Color(0xFF20B2AA),
                letterSpacing: 0.5,
              );
            }
            return TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: Colors.white.withValues(alpha: 0.4),
              letterSpacing: 0.5,
            );
          }),
          iconTheme: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return const IconThemeData(color: Color(0xFF20B2AA), size: 26);
            }
            return IconThemeData(
                color: Colors.white.withValues(alpha: 0.4), size: 24);
          }),
        ),
        child: NavigationBar(
          selectedIndex: shell.currentIndex,
          elevation: 0,
          onDestinationSelected: (index) {
            shell.goBranch(
              index,
              initialLocation: index == shell.currentIndex,
            );
          },
          destinations: [
            const NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              selectedIcon: Icon(Icons.dashboard),
              label: 'Dashboard',
            ),
            NavigationDestination(
              icon: Badge(
                isLabelVisible: badgeCount > 0,
                label: Text('$badgeCount'),
                backgroundColor: const Color(0xFF20B2AA),
                child: const Icon(Icons.list_alt),
              ),
              label: 'Logs',
            ),
            const NavigationDestination(
              icon: Icon(Icons.history_outlined),
              selectedIcon: Icon(Icons.history),
              label: 'History',
            ),
            const NavigationDestination(
              icon: Icon(Icons.settings_outlined),
              selectedIcon: Icon(Icons.settings),
              label: 'Settings',
            ),
          ],
        ),
      ),
    );
  }
}
