# GlassFormTextInput 高度/字号去硬编码

## 目标

`GlassFormTextInput` 不再硬编码 `h-8` 和 `text-[13px]`，由调用者自行决定。

## 改动

### 1. `GlassFormTextInput.tsx` — 去掉默认高度和字号

```diff
- className={`h-8 rounded-lg border border-border-muted bg-background/42 px-2.5 text-[13px] text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 ${className}`}
+ className={`rounded-lg border border-border-muted bg-background/42 px-2.5 text-text-primary shadow-soft outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 ${className}`}
```

### 2. `FormCalculateField.tsx` — 去掉 `!important`（2 处）

```diff
- className="!h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
+ className="h-7 w-full rounded-md px-1.5 text-[12px] shadow-none focus:ring-0"
```

位置：第 387 行、第 532 行

### 3. `FormPivot.tsx` — 补 `h-8 text-[13px]`

```diff
- className="w-full"
+ className="h-8 text-[13px] w-full"
```

位置：第 293 行

### 4. `FormUnnest.tsx` — 补 `h-8 text-[13px]`（4 处）

第 123 行：

```diff
- className="w-full"
+ className="h-8 text-[13px] w-full"
```

第 134 行：同上

第 190 行：

```diff
- className="w-full disabled:cursor-not-allowed disabled:opacity-40"
+ className="h-8 text-[13px] w-full disabled:cursor-not-allowed disabled:opacity-40"
```

第 214 行：

```diff
- className="w-full"
+ className="h-8 text-[13px] w-full"
```

### 5. `FormUnpivot.tsx` — 补 `h-8 text-[13px]`（2 处）

第 185 行、第 203 行：

```diff
- className="w-full"
+ className="h-8 text-[13px] w-full"
```

### 6. `FormJoin.tsx` — 补 `h-8 text-[13px]`（2 处）

第 734 行：

```diff
- className="w-[72px] shrink-0"
+ className="h-8 text-[13px] w-[72px] shrink-0"
```

第 881 行：

```diff
- className={`flex-1 min-w-0 ${conflictStrategy !== 'right_prefix' ? 'invisible' : ''}`}
+ className={`h-8 text-[13px] flex-1 min-w-0 ${conflictStrategy !== 'right_prefix' ? 'invisible' : ''}`}
```

### 7. `FormFieldMapping.tsx` — 不变

已传 `h-7 px-2 text-[12px]`，无需改动。

## 涉及文件（7 个）

| 文件                            | 改动类型                   |
| ------------------------------- | -------------------------- |
| `shared/GlassFormTextInput.tsx` | 去掉默认 h-8 text-[13px]   |
| `FormCalculateField.tsx`        | `!h-7` → `h-7`（×2）       |
| `FormPivot.tsx`                 | 补 `h-8 text-[13px]`       |
| `FormUnnest.tsx`                | 补 `h-8 text-[13px]`（×4） |
| `FormUnpivot.tsx`               | 补 `h-8 text-[13px]`（×2） |
| `FormJoin.tsx`                  | 补 `h-8 text-[13px]`（×2） |
| `FormFieldMapping.tsx`          | 不变                       |
