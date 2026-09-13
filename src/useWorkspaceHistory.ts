import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  readWorkspaceLocation,
  workspaceUrl,
  type WorkspaceLocation,
} from "./workspaceNavigation";
type Position = { y: number; list: number };
type Entry = { index: number; userId: number; position: Position };
const entry = (): Entry | undefined => history.state?.workspace;
export function useWorkspaceHistory(
  state: WorkspaceLocation,
  userId: number | undefined,
  restore: (value: WorkspaceLocation) => void,
) {
  const current = useRef({ state, userId, restore });
  current.current = { state, userId, restore };
  const previous = useRef<WorkspaceLocation | null>(null);
  const index = useRef(entry()?.index || 0);
  const owner = useRef<number | undefined>(undefined);
  const positions = useRef(new Map<number, Position>());
  const restoring = useRef(true);
  const pending = useRef<Entry | null>(null);
  const [locationRevision, setLocationRevision] = useState(0);
  const stopRestore = useRef<() => void>(() => {});
  const save = () => {
    if (!current.current.userId || restoring.current) return;
    const old = positions.current.get(index.current);
    const position = {
      y: window.scrollY,
      list: document.querySelector(".stock-list")?.scrollTop ?? old?.list ?? 0,
    };
    positions.current.set(index.current, position);
    history.replaceState(
      {
        ...history.state,
        workspace: {
          index: index.current,
          userId: current.current.userId,
          position,
        },
      },
      "",
    );
  };
  function restorePosition(position: Position) {
    stopRestore.current();
    restoring.current = true;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    });
    const finish = () => {
      observer.disconnect();
      mutations.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
    function apply() {
      window.scrollTo({ top: position.y, left: 0, behavior: "instant" });
      const list = document.querySelector(".stock-list");
      if (list) list.scrollTop = position.list;
      if (
        Math.abs(window.scrollY - position.y) <= 1 &&
        (!list || Math.abs(list.scrollTop - position.list) <= 1)
      )
        finish();
    }
    const timer = setTimeout(finish, 5000);
    observer.observe(document.getElementById("root")!);
    mutations.observe(document.getElementById("root")!, {
      childList: true,
      subtree: true,
    });
    frame = requestAnimationFrame(apply);
    stopRestore.current = finish;
  }
  useEffect(() => {
    const oldMode = history.scrollRestoration;
    history.scrollRestoration = "manual";
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      if (!restoring.current) {
        const old = positions.current.get(index.current);
        positions.current.set(index.current, {
          y: scrollY,
          list:
            document.querySelector(".stock-list")?.scrollTop ?? old?.list ?? 0,
        });
      }
      clearTimeout(timer);
      timer = setTimeout(save, 180);
    };
    const onPop = () => {
      clearTimeout(timer);
      const target = entry();
      const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog && target && target.index !== index.current) {
        // Back dismisses a dialog first; its own cancel handler protects unsaved drawings.
        history.go(index.current - target.index);
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        return;
      }
      const nextIndex = target?.index ?? 0;
      const validOwner = target?.userId === current.current.userId;
      pending.current = {
        index: nextIndex,
        userId: current.current.userId || 0,
        position: validOwner
          ? positions.current.get(nextIndex) || target!.position
          : { y: 0, list: 0 },
      };
      restoring.current = true;
      current.current.restore(readWorkspaceLocation(location.href));
      setLocationRevision((value) => value + 1);
    };
    const interrupt = () => stopRestore.current();
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    window.addEventListener("pagehide", save);
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    return () => {
      clearTimeout(timer);
      stopRestore.current();
      history.scrollRestoration = oldMode;
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
    };
  }, []);
  const key = JSON.stringify(state);
  useLayoutEffect(() => {
    if (!userId) {
      previous.current = null;
      owner.current = undefined;
      return;
    }
    const old = previous.current;
    const fresh = owner.current !== userId;
    const target = pending.current;
    if (!fresh && !target && JSON.stringify(old) === key) return;
    if (fresh) {
      positions.current.clear();
      owner.current = userId;
      const saved = entry();
      pending.current = {
        index: saved?.index || 0,
        userId,
        position: saved?.userId === userId ? saved.position : { y: 0, list: 0 },
      };
    }
    const locationRestore = pending.current;
    const changedScene =
      old &&
      (old.page !== state.page ||
        old.symbol !== state.symbol ||
        old.tradeTab !== state.tradeTab ||
        old.accountTab !== state.accountTab ||
        (state.page === "analysis" && old.analysis.tab !== state.analysis.tab));
    let position = positions.current.get(index.current) || {
      y: scrollY,
      list: document.querySelector(".stock-list")?.scrollTop || 0,
    };
    if (locationRestore) {
      index.current = locationRestore.index;
      position = locationRestore.position;
    } else if (changedScene) {
      history.replaceState(
        {
          ...history.state,
          workspace: { index: index.current, userId, position },
        },
        "",
      );
      index.current++;
      position = { y: 0, list: 0 };
    }
    const record = {
      ...history.state,
      workspace: { index: index.current, userId, position },
    };
    const url = workspaceUrl(state, location.href);
    if (changedScene && !locationRestore) history.pushState(record, "", url);
    else history.replaceState(record, "", url);
    positions.current.set(index.current, position);
    previous.current = state;
    pending.current = null;
    if (locationRestore || changedScene) restorePosition(position);
    else restoring.current = false;
  }, [key, userId, locationRevision]);
  return {
    restoring,
    restoreList: () => {
      const list = document.querySelector(".stock-list");
      if (list)
        list.scrollTop = positions.current.get(index.current)?.list || 0;
    },
  };
}
