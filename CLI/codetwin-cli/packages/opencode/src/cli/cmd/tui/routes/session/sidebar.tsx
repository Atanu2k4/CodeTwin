import { useSync } from "@tui/context/sync"
import { createMemo, Show } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { Installation } from "@/installation"
import { TuiPluginRuntime } from "../../plugin"

import { getScrollAcceleration } from "../../util/scroll"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const status = createMemo(() => sync.session.status(props.sessionID))
  const statusDetail = createMemo(() => sync.data.session_status[props.sessionID])
  const retryInfo = createMemo(() => {
    const value = statusDetail()
    if (value?.type !== "retry") return undefined
    return {
      attempt: value.attempt,
      message: value.message,
      next: value.next,
    }
  })
  const retryInSeconds = createMemo(() => {
    const value = retryInfo()
    if (!value) return null
    return Math.max(0, Math.ceil((value.next - Date.now()) / 1000))
  })
  const messageCount = createMemo(() => (sync.data.message[props.sessionID] ?? []).length)
  const changedFiles = createMemo(() => (sync.data.session_diff[props.sessionID] ?? []).length)
  const todos = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const pendingTodos = createMemo(() => todos().filter((item) => item.status !== "completed").length)
  const completedTodos = createMemo(() => Math.max(0, todos().length - pendingTodos()))
  const completionPercent = createMemo(() => {
    if (!todos().length) return 0
    return Math.round((completedTodos() / todos().length) * 100)
  })
  const completionBar = createMemo(() => {
    const total = 18
    const fill = Math.round((completionPercent() / 100) * total)
    return "█".repeat(fill) + "░".repeat(Math.max(0, total - fill))
  })
  const statusPill = createMemo(() => {
    if (retryInfo()) {
      return {
        label: "RETRY",
        color: theme.warning,
      }
    }
    if (status() === "working") {
      return {
        label: "LIVE",
        color: theme.accent,
      }
    }
    if (status() === "compacting") {
      return {
        label: "TRIM",
        color: theme.secondary,
      }
    }
    return {
      label: "READY",
      color: theme.success,
    }
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.background}
        width={38}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={1}
        paddingRight={1}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1} paddingLeft={1}>
            <box
              border={SplitBorder.border}
              customBorderChars={SplitBorder.customBorderChars}
              borderColor={statusPill().color}
            >
              <box
                backgroundColor={theme.backgroundPanel}
                paddingTop={1}
                paddingBottom={1}
                paddingLeft={2}
                paddingRight={2}
                gap={1}
              >
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.textMuted}>
                    <b>FIELD STATUS</b>
                  </text>
                  <text fg={statusPill().color}>
                    <b>● {statusPill().label}</b>
                  </text>
                </box>

                <TuiPluginRuntime.Slot
                  name="sidebar_title"
                  mode="single_winner"
                  session_id={props.sessionID}
                  title={session()!.title}
                  share_url={session()!.share?.url}
                >
                  <box paddingRight={1} gap={1}>
                    <text fg={theme.text}>
                      <b>{session()!.title}</b>
                    </text>
                    <Show when={session()!.share?.url}>
                      <text fg={theme.textMuted}>{session()!.share!.url}</text>
                    </Show>
                  </box>
                </TuiPluginRuntime.Slot>

                <box gap={0}>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>messages</text>
                    <text fg={theme.text}>{messageCount()}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>changed files</text>
                    <text fg={theme.text}>{changedFiles()}</text>
                  </box>
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>open todos</text>
                    <text fg={theme.text}>
                      {pendingTodos()} / {todos().length}
                    </text>
                  </box>
                </box>

                <Show when={todos().length > 0}>
                  <box>
                    <text fg={theme.textMuted}>todo progress</text>
                    <text fg={theme.success}>{completionBar()} {completionPercent()}%</text>
                  </box>
                </Show>

                <Show when={retryInfo()}>
                  <text fg={theme.warning}>
                    Retry {retryInfo()!.attempt} in ~{retryInSeconds() ?? 0}s
                  </text>
                </Show>
              </box>
            </box>

            <box border={SplitBorder.border} customBorderChars={SplitBorder.customBorderChars} borderColor={theme.borderActive}>
              <box backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
                <text fg={theme.primary}>
                  <b>Inspectors</b>
                </text>
                <text fg={theme.textMuted}>live context + diagnostics</text>
                <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
              </box>
            </box>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.primary }}>╚═</span> <b>CodeTwin</b> <span>{Installation.VERSION}</span>
            </text>
          </TuiPluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
