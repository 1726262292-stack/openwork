"use client";

type Props = {
  feature: string;
};

export function EnterprisePlanNotice(props: Props) {
  return (
    <div className="mb-6 rounded-[28px] border border-amber-200 bg-amber-50 px-6 py-5 text-[14px] text-amber-900">
      <span className="font-medium">{props.feature} is part of the Enterprise plan.</span>{" "}
      Your current configuration keeps working, but changing it requires an upgrade.{" "}
      <a
        href="https://openworklabs.com/enterprise"
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2"
      >
        Talk to us
      </a>
      .
    </div>
  );
}
