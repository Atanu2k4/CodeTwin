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
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
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
              child: const Icon(Icons.list_alt),
            ),
            label: 'Logs',
          ),
          const NavigationDestination(
            icon: Icon(Icons.history),
            label: 'History',
          ),
          const NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
