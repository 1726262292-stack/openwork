"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Check, Rocket, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

type Step =
  | { kind: "user"; content: string }
  | { kind: "tool"; name: string; result: string }
  | { kind: "agent"; content: string };

const script: Step[] = [
  { kind: "user", content: "Create a coworker for our sales team." },
  {
    kind: "tool",
    name: "create_coworker",
    result: "Created coworker · Sales Assistant"
  },
  {
    kind: "agent",
    content:
      "Done. I've created a new coworker called Sales Assistant. Want to connect some tools to it?"
  },
  {
    kind: "user",
    content: "Yes — connect it to Slack and HubSpot."
  },
  {
    kind: "tool",
    name: "connect_tools",
    result: "Connected Slack + HubSpot"
  },
  {
    kind: "agent",
    content:
      "Slack and HubSpot are connected. It can read your CRM, draft outreach, and post updates to your sales channel."
  },
  { kind: "user", content: "Deploy it." },
  {
    kind: "tool",
    name: "deploy_coworker",
    result: "Deployed · live in #sales"
  },
  {
    kind: "agent",
    content:
      "Sales Assistant is live. It's monitoring inbound leads and posting summaries to your #sales Slack channel now."
  }
];

const STEP_MS = 1700;
const LOOP_PAUSE_MS = 4500;

export function LandingCoworkerChatDemo() {
  const [visible, setVisible] = useState(1);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const total = script.length;

    const tick = (i: number) => {
      if (i < total) {
        setVisible(i + 1);
        timer = setTimeout(() => tick(i + 1), STEP_MS);
      } else {
        timer = setTimeout(() => {
          setVisible(0);
          timer = setTimeout(() => tick(1), 500);
        }, LOOP_PAUSE_MS);
      }
    };

    tick(1);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* App chrome */}
      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/80 px-4 py-2.5">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
        </div>
        <div className="flex items-center gap-2 text-[12px] font-medium text-gray-500">
          <Bot size={12} />
          OpenWork · Coworker
        </div>
        <span className="ml-auto flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
          <Rocket size={10} />
          Private beta
        </span>
      </div>

      {/* Chat */}
      <div className="flex min-h-[400px] flex-col gap-3 p-4 md:p-5">
        <AnimatePresence initial={false}>
          {script.slice(0, visible).map((step, i) => {
            if (step.kind === "user") {
              return (
                <motion.div
                  key={`u-${i}`}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="self-end rounded-2xl rounded-br-md bg-[#011627] px-4 py-2.5 text-[13px] leading-relaxed text-white shadow-sm"
                >
                  {step.content}
                </motion.div>
              );
            }

            if (step.kind === "tool") {
              return (
                <motion.div
                  key={`t-${i}`}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-1.5 self-start"
                >
                  <div className="inline-flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-600">
                    <Wrench size={12} className="text-gray-400" />
                    <span className="font-mono text-[11px] text-gray-700">
                      {step.name}
                    </span>
                    <Check size={12} className="text-green-500" />
                  </div>
                  <div className="ml-1 text-[11px] text-gray-400">
                    {step.result}
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={`a-${i}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className="max-w-[90%] self-start rounded-2xl rounded-bl-md bg-gray-100/80 px-4 py-2.5 text-[13px] leading-relaxed text-[#011627]"
              >
                {step.content}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {visible < script.length ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-1.5 self-start rounded-2xl rounded-bl-md bg-gray-100/80 px-4 py-3"
          >
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
          </motion.div>
        ) : null}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-[12px] text-gray-400">
            Design and deploy your coworker…
          </span>
          <span className="rounded-full bg-[#011627] px-3 py-1 text-[10px] font-medium text-white">
            Send
          </span>
        </div>
      </div>
    </div>
  );
}
