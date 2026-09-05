import { expect, test } from "@playwright/test";
import palette from "../../lib/atlas-world/data/political-palette.v1.json";
import countries from "../../lib/atlas-world/data/countries.v1.json";
import { atlasPoliticalColor } from "../../lib/atlas-world/politicalPalette";

test("every retained entity has a fixed political identity, including the requested familiar colors", () => {
  expect(Object.keys(palette.colors)).toHaveLength(242);
  for (const country of countries.countries) {
    const code = country.id.split(":").at(-1)!;
    expect((palette.colors as Record<string,string>)[code]).toMatch(/^#[a-f0-9]{6}$/);
  }
  for(const [code,color] of Object.entries({FRA:"#4d80b6",USA:"#719bc4",GBR:"#cb6e80",CHN:"#c96554",MEX:"#76a57c"})) {
    expect(atlasPoliticalColor(`country:${code}`)).toBe(color);
  }
});

test("view browser is a real modal, uses named views, and returns focus", async ({page}) => {
  await page.goto("/atlas");
  const trigger=page.getByRole("button",{name:"Choose view: Political",exact:true});
  await trigger.click();
  const dialog=page.getByRole("dialog",{name:"Explore the map"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Religion",exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("button",{name:"Religion",exact:true}).click();
  await expect(page).toHaveURL(/view=religion/);
  await expect(page.getByRole("button",{name:"Choose view: Religion",exact:true})).toBeFocused();
});

test("the camera explores beyond the previous ceiling and city focus survives reload", async ({page,isMobile}) => {
  test.skip(isMobile,"The physical-city click is exercised on desktop; phone has its own touch flow.");
  await page.goto("/atlas?view=where-people-live&country=egy");
  await expect(page.getByRole("heading",{name:"Egypt",exact:true})).toBeVisible();
  for(let i=0;i<4;i++)await page.getByRole("button",{name:"Zoom in",exact:true}).click();
  const group=page.locator("[data-atlas-map-group]");
  expect(Number(await group.getAttribute("data-atlas-zoom-scale"))).toBeGreaterThan(8);
  // City is a independently addressable feature, never an alias for country.
  const cairo=page.locator('[data-atlas-city]').filter({has:page.locator('title',{hasText:/^Cairo$/})}).first();
  const id=await cairo.getAttribute("data-atlas-city");
  expect(id).toBeTruthy();
  await page.goto(`/atlas?view=where-people-live&focus=${encodeURIComponent(`feature:${id}`)}`);
  await expect(page.locator("[data-atlas-city-card]").getByRole("heading",{name:"Cairo",exact:true})).toBeVisible();
  await expect(page.locator("[data-atlas-city-card]").getByRole("button",{name:"Egypt",exact:false})).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-atlas-city-card]")).toBeVisible();
});

test("a visible city selects a city, not the underlying country", async ({page,isMobile}) => {
  await page.goto("/atlas?view=political&country=egy", {waitUntil:"networkidle"});
  await expect(page.getByRole("heading",{name:"Egypt",exact:true})).toBeVisible();
  const cairo=page.locator('[data-atlas-city]').filter({has:page.locator('title',{hasText:/^Cairo$/})}).first();
  const dot=cairo.locator("circle").filter({has:page.locator("title")});
  await expect(dot).toBeVisible();
  const box=(await dot.boundingBox())!;
  if(isMobile)await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
  else await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect(page.locator("[data-atlas-city-card]").getByRole("heading",{name:"Cairo",exact:true})).toBeVisible();
  await expect(page.locator("[data-atlas-sheet]")).toHaveCount(0);
  await expect(page).toHaveURL(/focus=feature/);
  await page.getByRole("button",{name:"Egypt",exact:false}).click();
  await expect(page.locator("[data-atlas-sheet]").getByRole("heading",{name:"Egypt",exact:true})).toBeVisible();
});

test("phone pinch and drag change the map camera without selecting a place", async ({page,context,isMobile}) => {
  test.skip(!isMobile,"Touch input is exercised on the phone project.");
  await page.goto("/atlas",{waitUntil:"networkidle"});
  const map=page.locator("[data-atlas-map-group]");
  await expect(map).toHaveAttribute("data-atlas-zoom-scale",/[0-9]/);
  const initial=Number(await map.getAttribute("data-atlas-zoom-scale"));
  const touch=await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:160,y:320,id:0},{x:240,y:320,id:1}]});
  for(let i=1;i<=8;i++)await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:160-i*9,y:320,id:0},{x:240+i*9,y:320,id:1}]});
  await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect.poll(async()=>Number(await map.getAttribute("data-atlas-zoom-scale"))).toBeGreaterThan(initial*2);
  const beforePan=await map.getAttribute("transform");
  await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:180,y:360,id:0}]});
  for(let i=1;i<=8;i++)await touch.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:180+i*10,y:360+i*3,id:0}]});
  await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect(map).not.toHaveAttribute("transform",beforePan!);
  await expect(page.locator("[data-atlas-sheet], [data-atlas-city-card]")).toHaveCount(0);
  await touch.detach();
});
