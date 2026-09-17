/**
 * Dev-only showcase for the shared `components/ui` primitives. Run the vite dev
 * server and open /preview-ui.html to check every variant/tone/state across the
 * light/dark themes and accent themes without touching the app shell.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import i18n from './i18n/config';
import './styles/globals.css';
import {
  Badge,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from './components/ui';

const ACCENT_THEMES = ['default', 'lake', 'lavender', 'orange', 'rose'];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-semibold text-text-primary">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

function PreviewApp() {
  const [light, setLight] = React.useState(false);
  const [accent, setAccent] = React.useState('default');
  const [switchOn, setSwitchOn] = React.useState(true);
  const [selectValue, setSelectValue] = React.useState('a');
  const [tab, setTab] = React.useState('one');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('示例文本 sample');

  React.useEffect(() => {
    document.documentElement.classList.toggle('light', light);
    if (accent === 'default') {
      document.documentElement.removeAttribute('data-accent-theme');
    } else {
      document.documentElement.setAttribute('data-accent-theme', accent);
    }
  }, [light, accent]);

  return (
    <div className="min-h-screen bg-background p-6 font-sans text-text-primary">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-base font-semibold">UI primitives</h1>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setLight((v) => !v)}>
              theme: {light ? 'light' : 'dark'}
            </Button>
            <Select value={accent} onValueChange={setAccent}>
              <SelectTrigger className="w-32" aria-label="accent theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCENT_THEMES.map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {theme}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        <Section title="Button">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </Section>

        <Section title="Input">
          <div className="w-56">
            <Input value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
          </div>
          <div className="w-56">
            <Input placeholder="placeholder" />
          </div>
          <div className="w-56">
            <Input error defaultValue="error state" />
          </div>
          <div className="w-56">
            <Input disabled defaultValue="disabled" />
          </div>
        </Section>

        <Section title="Select / Dropdown / Switch">
          <Select value={selectValue} onValueChange={setSelectValue}>
            <SelectTrigger className="w-44" aria-label="demo select">
              <SelectValue placeholder="Pick…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A 选项</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
              <SelectItem value="c" disabled>
                Disabled option
              </SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Label</DropdownMenuLabel>
              <DropdownMenuItem>Item one</DropdownMenuItem>
              <DropdownMenuItem>Item two</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Switch checked={switchOn} onCheckedChange={setSwitchOn} aria-label="demo switch" />
          <Switch checked={false} disabled aria-label="disabled switch" />
        </Section>

        <Section title="Badge / Tabs">
          <Badge>default</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="success">success</Badge>
          <Badge tone="warning">warning</Badge>
          <Badge tone="error">error</Badge>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="one">Tab 一</TabsTrigger>
              <TabsTrigger value="two">Tab 二</TabsTrigger>
            </TabsList>
            <TabsContent value="one" className="mt-2 text-[13px] text-text-secondary">
              First panel
            </TabsContent>
            <TabsContent value="two" className="mt-2 text-[13px] text-text-secondary">
              Second panel
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Dialog">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Dialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            closeOnOverlayClick
            ariaLabelledBy="preview-dialog-title"
          >
            <DialogTitle id="preview-dialog-title">Dialog 标题</DialogTitle>
            <DialogDescription>Esc 关闭，遮罩点击关闭，关闭后焦点回到触发按钮。</DialogDescription>
            <DialogFooter>
              <Button size="sm" data-autofocus onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => setDialogOpen(false)}>
                Confirm
              </Button>
            </DialogFooter>
          </Dialog>
        </Section>
      </div>
    </div>
  );
}

void i18n.changeLanguage('zh').then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PreviewApp />
    </React.StrictMode>
  );
});
