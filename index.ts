// Plugin entry: registers the tmux tools and the tmux skill.

import { Plugin } from "@opencode/plugin"
import { registerSkills } from "./src/skills.js"
import { registerTools } from "./src/tools.js"

export default Plugin.define({
  id: "tmux",
  setup: async (ctx) => {
    await registerTools(ctx)
    await registerSkills(ctx)
  },
})
