import * as React from "react";

import {
  Tabs as BaseTabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface TabDefinition {
  content: React.ReactNode;
  key: string;
  title: React.ReactNode;
}

export interface TabsProps {
  "aria-label"?: string;
  children: React.ReactNode;
  disableCursorAnimation?: boolean;
  onSelectionChange?: (key: React.Key) => void;
  selectedKey?: React.Key;
}

export interface TabProps {
  children: React.ReactNode;
  title: React.ReactNode;
}

export function Tab(_props: TabProps) {
  return null;
}

Tab.displayName = "HeroTab";

function parseTabs(children: React.ReactNode) {
  const tabs: TabDefinition[] = [];

  React.Children.forEach(children, (child, index) => {
    if (!React.isValidElement(child) || child.type !== Tab) {
      return;
    }

    const key = child.key ? String(child.key) : `tab-${index}`;
    const props = child.props as TabProps;

    tabs.push({
      content: props.children,
      key,
      title: props.title,
    });
  });

  return tabs;
}

export function Tabs({ children, onSelectionChange, selectedKey }: TabsProps) {
  const tabs = React.useMemo(() => parseTabs(children), [children]);
  const fallback = tabs[0]?.key ?? "";
  const isControlled = selectedKey !== undefined;
  const value = isControlled ? String(selectedKey) : fallback;

  return (
    <BaseTabs
      {...(isControlled ? { value } : { defaultValue: fallback })}
      onValueChange={(nextValue) => {
        onSelectionChange?.(nextValue);
      }}
    >
      <TabsList className="w-full sm:w-fit gap-0 sm:gap-2">
        {tabs.map((item) => (
          <TabsTrigger
            key={item.key}
            className="flex-1 sm:flex-initial px-3 py-1.5 text-sm font-semibold sm:px-4 sm:py-2 sm:text-base whitespace-nowrap"
            value={item.key}
          >
            {item.title}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((item) => (
        <TabsContent key={item.key} value={item.key}>
          {item.content}
        </TabsContent>
      ))}
    </BaseTabs>
  );
}
