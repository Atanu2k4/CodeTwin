import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createSignal } from "solid-js"
import { Logo } from "../component/logo"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { TuiPluginRuntime } from "../plugin"
import { SplitBorder } from "../component/border"
import { useTheme } from "../context/theme"

// TODO: what is the best way to do this?
let once = false
const placeholder = {
  normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
  shell: ["ls -la", "git status", "pwd"],
}

export function Home() {
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const { theme } = useTheme()
  let sent = false

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.initialPrompt) {
      r.set(route.initialPrompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <>
      <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
        <box border={SplitBorder.border} customBorderChars={SplitBorder.customBorderChars} borderColor={theme.borderActive}>
          <box backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
            <text fg={theme.textMuted}>
              <b>CODETWIN TERMINAL SUITE</b>
            </text>
            <text fg={theme.text}>Plan, patch, and ship from one command deck.</text>
          </box>
        </box>

        <box border={SplitBorder.border} customBorderChars={SplitBorder.customBorderChars} borderColor={theme.border}>
          <box backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
            <TuiPluginRuntime.Slot name="home_logo" mode="replace">
              <Logo />
            </TuiPluginRuntime.Slot>
            <text fg={theme.textMuted}>Tip: start with a concrete goal and expected output format.</text>
          </box>
        </box>

        <box border={SplitBorder.border} customBorderChars={SplitBorder.customBorderChars} borderColor={theme.primary}>
          <box backgroundColor={theme.backgroundPanel} paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
            <text fg={theme.primary}>
              <b>Compose Mission</b>
            </text>
            <TuiPluginRuntime.Slot name="home_prompt" mode="replace" workspace_id={route.workspaceID} ref={bind}>
              <Prompt
                ref={bind}
                workspaceID={route.workspaceID}
                right={<TuiPluginRuntime.Slot name="home_prompt_right" workspace_id={route.workspaceID} />}
                placeholders={placeholder}
              />
            </TuiPluginRuntime.Slot>
          </box>
        </box>

        <TuiPluginRuntime.Slot name="home_bottom" />
        <Toast />
      </box>
      <box width="100%" flexShrink={0}>
        <TuiPluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </>
  )
}
