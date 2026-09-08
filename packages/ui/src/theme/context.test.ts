import { beforeEach, describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { ThemeTesting, type ColorScheme, type ThemeStore } from "./context"
import type { DesktopTheme } from "./types"

const {
  isValidThemeId,
  createThemeLoader,
  createSetTheme,
  createSetColorScheme,
  createOnStorage,
  createPreviewTheme,
  createPreviewColorScheme,
  createCommitPreview,
  createCancelPreview,
} = ThemeTesting

const fakeTheme = { id: "oc-2", name: "OC-2", light: {}, dark: {} } as unknown as DesktopTheme

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  clear() {
    this.values.clear()
  }
  get length() {
    return this.values.size
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
  removeItem(key: string) {
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

beforeEach(() => {
  storage.clear()
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
})

function makeStore(overrides: Partial<ThemeStore> = {}) {
  return createStore<ThemeStore>({
    themes: {},
    themeId: "oc-2",
    colorScheme: "system",
    mode: "light",
    previewThemeId: null,
    previewScheme: null,
    ...overrides,
  } as ThemeStore)
}

describe("isValidThemeId", () => {
  test("the built-in oc-2 theme is always valid", () => {
    const [store] = makeStore()
    expect(isValidThemeId(store, "oc-2")).toBe(true)
  })
})

describe("createSetTheme", () => {
  test("warns and does not change state for an empty id", () => {
    const [store, setStore] = makeStore({ themeId: "oc-2" })
    const setTheme = createSetTheme(store, setStore, () => Promise.resolve(undefined))

    setTheme("")

    expect(store.themeId).toBe("oc-2")
  })

  test("selecting oc-2 persists the id and clears cached custom-theme css", () => {
    const [store, setStore] = makeStore({ themeId: "dracula" })
    const setTheme = createSetTheme(store, setStore, () => Promise.resolve(undefined))
    storage.setItem("opencode-theme-css-light", "cached")
    storage.setItem("opencode-theme-css-dark", "cached")

    setTheme("oc-2")

    expect(store.themeId).toBe("oc-2")
    expect(storage.getItem("opencode-theme-id")).toBe("oc-2")
    expect(storage.getItem("opencode-theme-css-light")).toBeNull()
    expect(storage.getItem("opencode-theme-css-dark")).toBeNull()
  })
})

describe("createSetColorScheme", () => {
  test("persists the scheme and resolves mode for light/dark", () => {
    const [store, setStore] = makeStore()
    const setColorScheme = createSetColorScheme(setStore)

    setColorScheme("dark")

    expect(store.colorScheme).toBe("dark")
    expect(store.mode).toBe("dark")
    expect(storage.getItem("opencode-color-scheme")).toBe("dark")
  })

  test("system scheme falls back to light mode when there is no window", () => {
    const [store, setStore] = makeStore()
    const setColorScheme = createSetColorScheme(setStore)

    setColorScheme("system")

    expect(store.colorScheme).toBe("system")
    expect(store.mode).toBe("light")
  })
})

describe("createOnStorage", () => {
  test("ignores unrelated storage keys", () => {
    const [store, setStore] = makeStore({ colorScheme: "system", mode: "light" })
    const onStorage = createOnStorage(store, setStore, () => Promise.resolve(undefined))

    onStorage({ key: "some-other-key", newValue: "dark" } as StorageEvent)

    expect(store.colorScheme).toBe("system")
    expect(store.mode).toBe("light")
  })

  test("syncs colorScheme and mode from a cross-tab storage event", () => {
    const [store, setStore] = makeStore({ colorScheme: "system", mode: "light" })
    const onStorage = createOnStorage(store, setStore, () => Promise.resolve(undefined))

    onStorage({ key: "opencode-color-scheme", newValue: "dark" as ColorScheme } as StorageEvent)

    expect(store.colorScheme).toBe("dark")
    expect(store.mode).toBe("dark")
  })

  test("switching back to oc-2 via storage clears cached custom-theme css", () => {
    const [store, setStore] = makeStore({ themeId: "dracula" })
    const onStorage = createOnStorage(store, setStore, () => Promise.resolve(undefined))
    storage.setItem("opencode-theme-css-light", "cached")

    onStorage({ key: "opencode-theme-id", newValue: "oc-2" } as StorageEvent)

    expect(store.themeId).toBe("oc-2")
    expect(storage.getItem("opencode-theme-css-light")).toBeNull()
  })
})

describe("createThemeLoader", () => {
  test("resolves undefined for an empty id without touching the theme registry", () => {
    const [store, setStore] = makeStore()
    const load = createThemeLoader(store, setStore)

    return load("").then((theme) => {
      expect(theme).toBeUndefined()
    })
  })

  test("returns an already-loaded theme from the store without re-fetching", () => {
    const [store, setStore] = makeStore({ themes: { "oc-2": fakeTheme } })
    const load = createThemeLoader(store, setStore)

    return load("oc-2").then((theme) => {
      expect(theme).toBe(fakeTheme)
    })
  })
})

describe("createPreviewTheme", () => {
  test("marks the theme as previewing, then applies it once loaded", async () => {
    const [store, setStore] = makeStore({ mode: "light", colorScheme: "light" })
    const load = (id: string) => Promise.resolve(id === "oc-2" ? fakeTheme : undefined)
    const applied: unknown[] = []
    const previewTheme = createPreviewTheme(store, setStore, load, (...args) => applied.push(args))

    previewTheme("oc-2")
    expect(store.previewThemeId).toBe("oc-2")

    await Promise.resolve()
    await Promise.resolve()

    expect(applied).toEqual([[fakeTheme, "oc-2", "light", "light"]])
  })

  test("does not apply the theme if the preview was changed before it finished loading", async () => {
    const [store, setStore] = makeStore()
    const load = (id: string) => Promise.resolve(id === "oc-2" ? fakeTheme : undefined)
    const applied: unknown[] = []
    const previewTheme = createPreviewTheme(store, setStore, load, (...args) => applied.push(args))

    previewTheme("oc-2")
    setStore("previewThemeId", null)

    await Promise.resolve()
    await Promise.resolve()

    expect(applied).toEqual([])
  })
})

describe("createPreviewColorScheme", () => {
  test("previews the scheme against the current theme once loaded", async () => {
    const [store, setStore] = makeStore({ themeId: "oc-2" })
    const load = (id: string) => Promise.resolve(id === "oc-2" ? fakeTheme : undefined)
    const applied: unknown[] = []
    const previewColorScheme = createPreviewColorScheme(store, setStore, load, (...args) => applied.push(args))

    previewColorScheme("dark")
    expect(store.previewScheme).toBe("dark")

    await Promise.resolve()
    await Promise.resolve()

    expect(applied).toEqual([[fakeTheme, "oc-2", "dark", "dark"]])
  })

  test("does not apply a stale preview if the scheme changed again before loading finished", async () => {
    const [store, setStore] = makeStore({ themeId: "oc-2" })
    const load = (id: string) => Promise.resolve(id === "oc-2" ? fakeTheme : undefined)
    const applied: unknown[] = []
    const previewColorScheme = createPreviewColorScheme(store, setStore, load, (...args) => applied.push(args))

    previewColorScheme("dark")
    previewColorScheme("light")

    await Promise.resolve()
    await Promise.resolve()

    expect(applied).toEqual([[fakeTheme, "oc-2", "light", "light"]])
  })
})

describe("createCommitPreview", () => {
  test("commits a pending theme and scheme preview, then clears preview state", () => {
    const [store, setStore] = makeStore({ previewThemeId: "dracula", previewScheme: "dark" })
    const setThemeCalls: string[] = []
    const setColorSchemeCalls: ColorScheme[] = []
    const commitPreview = createCommitPreview(
      store,
      setStore,
      (id) => setThemeCalls.push(id),
      (scheme) => setColorSchemeCalls.push(scheme),
    )

    commitPreview()

    expect(setThemeCalls).toEqual(["dracula"])
    expect(setColorSchemeCalls).toEqual(["dark"])
    expect(store.previewThemeId).toBeNull()
    expect(store.previewScheme).toBeNull()
  })

  test("does nothing when there is no pending preview", () => {
    const [store, setStore] = makeStore()
    const setThemeCalls: string[] = []
    const setColorSchemeCalls: ColorScheme[] = []
    const commitPreview = createCommitPreview(
      store,
      setStore,
      (id) => setThemeCalls.push(id),
      (scheme) => setColorSchemeCalls.push(scheme),
    )

    commitPreview()

    expect(setThemeCalls).toEqual([])
    expect(setColorSchemeCalls).toEqual([])
  })
})

describe("createCancelPreview", () => {
  test("clears preview state and re-applies the committed theme", async () => {
    const [store, setStore] = makeStore({
      themeId: "oc-2",
      mode: "light",
      colorScheme: "light",
      previewThemeId: "dracula",
      previewScheme: "dark",
    })
    const load = (id: string) => Promise.resolve(id === "oc-2" ? fakeTheme : undefined)
    const applied: unknown[] = []
    const cancelPreview = createCancelPreview(store, setStore, load, (...args) => applied.push(args))

    cancelPreview()

    expect(store.previewThemeId).toBeNull()
    expect(store.previewScheme).toBeNull()

    await Promise.resolve()
    await Promise.resolve()

    expect(applied).toEqual([[fakeTheme, "oc-2", "light", "light"]])
  })
})
