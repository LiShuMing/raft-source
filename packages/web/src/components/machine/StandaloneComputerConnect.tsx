import { useState } from "react";
import { Button } from "@botiverse/raft-ui";
import LocalComputerConnect from "./LocalComputerConnect";
import RemoteComputerConnect from "./RemoteComputerConnect";

export default function StandaloneComputerConnect({ serverId }: { serverId: string }) {
  const [target, setTarget] = useState<"local" | "remote">("local");
  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="Execution machine">
        <Button variant={target === "local" ? "accent" : "outline"} aria-pressed={target === "local"} onClick={() => setTarget("local")}>Server host</Button>
        <Button variant={target === "remote" ? "accent" : "outline"} aria-pressed={target === "remote"} onClick={() => setTarget("remote")}>Another machine</Button>
      </div>
      {target === "local" ? <LocalComputerConnect serverId={serverId} /> : <RemoteComputerConnect serverId={serverId} />}
    </div>
  );
}
