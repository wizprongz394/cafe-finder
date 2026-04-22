"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import MapView from "@/components/MapView";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LatLon { latitude: number; longitude: number; }
interface PlaceTag {
  name: string; amenity: string; cuisine?: string;
  opening_hours?: string; phone?: string; brand?: string;
  address?: string; mapbox_cats?: string;
  [key: string]: string | undefined;
}
interface RawPlace { lat: number; lon: number; tags: PlaceTag; }
interface EnrichedPlace extends RawPlace {
  distance: number;
  estimatedCostForTwo: number;
  priceSource: "known-chain" | "cuisine" | "name-hint" | "amenity-type" | "default";
  score: number;
}
interface GroupUser {
  id: string; label: string;
  location: LatLon | null; locationLabel: string;
  maxBudget: number; preferences: string[];
}
interface GroupEnrichedPlace extends EnrichedPlace {
  groupScore: number; maxDistanceKm: number; avgDistanceKm: number;
  budgetOk: boolean[]; prefMatches: string[];
  userPain: number[];
  isPerfectMatch?: boolean;
}
interface SplitMatch {
  placeA: EnrichedPlace; placeB: EnrichedPlace;
  distanceBetween: number; score: number;
  assignment: Record<string, "A" | "B" | "either">;
  reasons: string[]; walkMinutes: number;
}
interface PlanResult { text: string; meetupFlow: string[]; fairnessSummary: string; }
interface MapboxFeature { center: [number, number]; place_name: string; text: string; }

// ─── Constants ────────────────────────────────────────────────────────────────
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
const MAPBOX_CATEGORIES = ["restaurant","cafe","fast_food","coffee_shop","bakery","ice_cream"];
const BUDGET_OPTIONS = [200, 300, 500, 700, 1000, 1500, 2000];
const PREF_SUGGESTIONS = ["biryani","cafe","momo","pizza","chinese","south indian","kebab","sweets","seafood","coffee"];

const T = {
  sand:      "#FFECD1",
  chocolate: "#3E000C",
  cream:     "#F3E9DC",
  caramel:   "#C08552",
  brownie:   "#5E3023",
  coffee:    "#895737",
  green:     "#4a7c59",
  red:       "#9e3a3a",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidCoord(lat: number, lon: number): boolean {
  return typeof lat==="number"&&typeof lon==="number"&&!isNaN(lat)&&!isNaN(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
}
function haversineKm(lat1:number,lon1:number,lat2:number,lon2:number): number {
  const R=6371,dLat=((lat2-lat1)*Math.PI)/180,dLon=((lon2-lon1)*Math.PI)/180;
  const a=Math.sin(dLat/2)**2+Math.cos((lat1*Math.PI)/180)*Math.cos((lat2*Math.PI)/180)*Math.sin(dLon/2)**2;
  return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}
function centroid(locs:LatLon[]):LatLon {
  const n=locs.length;
  return { latitude:locs.reduce((s,l)=>s+l.latitude,0)/n, longitude:locs.reduce((s,l)=>s+l.longitude,0)/n };
}
function priceColor(cost:number):string { return cost<=400?T.green:cost<=900?T.caramel:T.red; }
function priceLabel(cost:number):string { return cost<=300?"₹":cost<=700?"₹₹":cost<=1200?"₹₹₹":"₹₹₹₹"; }
function categoryEmoji(amenity:string):string {
  if(amenity==="cafe") return "☕"; if(amenity==="fast_food") return "🍔"; if(amenity==="bar") return "🍺"; return "🍽️";
}
function placeEmoji(place:EnrichedPlace):string {
  const n=place.tags.name.toLowerCase();
  if(/momo/.test(n)) return "🥟"; if(/biryani/.test(n)) return "🍚"; if(/pizza/.test(n)) return "🍕";
  if(/burger/.test(n)) return "🍔"; if(/cake|bakery/.test(n)) return "🥐"; if(/tea|chai/.test(n)) return "🍵";
  if(/coffee|cafe/.test(n)) return "☕"; if(/chinese|noodle/.test(n)) return "🍜";
  return categoryEmoji(place.tags.amenity);
}
function mapsUrl(place:EnrichedPlace):string { return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`; }
function estimateCost(place:RawPlace):{cost:number;source:string} {
  const n=(place.tags?.name??"").toLowerCase();
  if(n.includes("momo")) return {cost:250,source:"name-hint"};
  if(n.includes("biryani")) return {cost:500,source:"name-hint"};
  if(n.includes("pizza")) return {cost:600,source:"name-hint"};
  if(n.includes("burger")) return {cost:400,source:"name-hint"};
  if(n.includes("cafe")||n.includes("coffee")) return {cost:500,source:"name-hint"};
  if(place.tags?.amenity==="fast_food") return {cost:350,source:"type"};
  if(place.tags?.amenity==="cafe") return {cost:500,source:"type"};
  if(place.tags?.amenity==="restaurant") return {cost:700,source:"type"};
  return {cost:600,source:"default"};
}
function computeScore(p:EnrichedPlace):number {
  let s=Math.max(0,20-p.distance*5);
  if(p.estimatedCostForTwo>=250&&p.estimatedCostForTwo<=900) s+=4;
  if(p.tags.name&&p.tags.name.length>3) s+=2;
  if(p.tags.cuisine) s+=2;
  return s;
}
function computeUserPain(place:EnrichedPlace,user:GroupUser):number {
  if(!user.location) return 0;
  const dist=haversineKm(user.location.latitude,user.location.longitude,place.lat,place.lon);
  const budgetOverrun=Math.max(0,place.estimatedCostForTwo-user.maxBudget);
  const txt=(place.tags.name+" "+(place.tags.cuisine??"")).toLowerCase();
  const prefMiss=user.preferences.length>0&&!user.preferences.some(p=>txt.includes(p))?4:0;
  return dist*3+budgetOverrun/100+prefMiss;
}
function scoreForGroup(place:EnrichedPlace,users:GroupUser[]):Omit<GroupEnrichedPlace,keyof EnrichedPlace> {
  const active=users.filter(u=>u.location);
  if(!active.length) return {groupScore:0,maxDistanceKm:0,avgDistanceKm:0,budgetOk:[],prefMatches:[],userPain:[]};
  const dists=active.map(u=>haversineKm(u.location!.latitude,u.location!.longitude,place.lat,place.lon));
  const avg=dists.reduce((a,b)=>a+b,0)/dists.length,max=Math.max(...dists);
  const budgetOk=active.map(u=>place.estimatedCostForTwo<=u.maxBudget);
  const budgetScore=budgetOk.filter(Boolean).length/active.length;
  const txt=(place.tags.name+" "+(place.tags.cuisine??"")).toLowerCase();
  const prefMatches=active.flatMap(u=>u.preferences.filter(p=>txt.includes(p)));
  const userPain=active.map(u=>computeUserPain(place,u));
  const groupScore=-avg*4-max*2+budgetScore*15+prefMatches.length*10;
  return {groupScore,maxDistanceKm:max,avgDistanceKm:avg,budgetOk,prefMatches:[...new Set(prefMatches)],userPain};
}
function findSplitMatches(places:EnrichedPlace[],users:GroupUser[]):SplitMatch[] {
  const active=users.filter(u=>u.location);
  if(active.length<2) return [];
  const results:SplitMatch[]=[];
  for(let i=0;i<places.length&&i<60;i++) {
    for(let j=i+1;j<places.length&&j<60;j++) {
      const A=places[i],B=places[j];
      const dist=haversineKm(A.lat,A.lon,B.lat,B.lon);
      if(dist>0.5) continue;
      let score=0,satisfiedUsers=0;
      const assignment:Record<string,"A"|"B"|"either">={};
      for(const user of active) {
        const txtA=(A.tags.name+" "+(A.tags.cuisine??"")).toLowerCase();
        const txtB=(B.tags.name+" "+(B.tags.cuisine??"")).toLowerCase();
        const prefA=user.preferences.some(p=>txtA.includes(p));
        const prefB=user.preferences.some(p=>txtB.includes(p));
        const budgetA=A.estimatedCostForTwo<=user.maxBudget;
        const budgetB=B.estimatedCostForTwo<=user.maxBudget;
        if(prefA&&budgetA&&prefB&&budgetB){assignment[user.id]="either";satisfiedUsers++;score+=8;}
        else if(prefA&&budgetA){assignment[user.id]="A";satisfiedUsers++;score+=10;}
        else if(prefB&&budgetB){assignment[user.id]="B";satisfiedUsers++;score+=10;}
        else if(budgetA||budgetB){assignment[user.id]=budgetA?"A":"B";score+=3;}
        else score-=5;
      }
      score+=Math.max(0,8-dist*15);
      if(satisfiedUsers<Math.ceil(active.length*0.5)) continue;
      const walkMinutes=Math.max(1,Math.round(dist*12));
      results.push({placeA:A,placeB:B,distanceBetween:dist,score,assignment,reasons:[],walkMinutes});
    }
  }
  return results.sort((a,b)=>b.score-a.score).slice(0,5);
}
function generateMeetupFlow(match:SplitMatch,users:GroupUser[]):string[] {
  const active=users.filter(u=>u.location);
  const goA=active.filter(u=>match.assignment[u.id]==="A"||match.assignment[u.id]==="either");
  const goB=active.filter(u=>match.assignment[u.id]==="B");
  const steps:string[]=[];
  if(goA.length) steps.push(`${placeEmoji(match.placeA)} ${goA.map(u=>u.label).join(" & ")} → ${match.placeA.tags.name}`);
  if(goB.length) steps.push(`${placeEmoji(match.placeB)} ${goB.map(u=>u.label).join(" & ")} → ${match.placeB.tags.name}`);
  steps.push(`🚶 Walk ${Math.round(match.distanceBetween*1000)}m (~${match.walkMinutes} min) to meet up`);
  return steps;
}
function buildExplainPrompt(match:SplitMatch,users:GroupUser[]):string {
  const active=users.filter(u=>u.location);
  const userLines=active.map(u=>{
    const dest=match.assignment[u.id]==="B"?match.placeB:match.placeA;
    return `${u.label} (₹${u.maxBudget}, likes: ${u.preferences.join(", ")||"anything"}) → ${dest.tags.name}`;
  }).join("\n");
  return `Write ONE short sentence explaining why this eating plan works for this group in India. Plain text only.\n\nPlan: ${active.length} friends eat at different spots then meet up.\n- ${match.placeA.tags.name} (≈₹${match.placeA.estimatedCostForTwo})\n- ${match.placeB.tags.name} (≈₹${match.placeB.estimatedCostForTwo})\n- ${Math.round(match.distanceBetween*1000)}m apart (~${match.walkMinutes} min walk)\n${userLines}`;
}
function placeKey(p:EnrichedPlace):string { return `${p.tags.name}-${p.lat.toFixed(4)}-${p.lon.toFixed(4)}`; }

// ─── FIX 1: High-accuracy geolocation helper ─────────────────────────────────
// The default browser geolocation uses cached/IP-based position (hence Shyambazar
// instead of Khardah). enableHighAccuracy:true forces GPS/WiFi triangulation.
// maximumAge:0 prevents stale cached coordinates. timeout:10000 is a 10s fallback.
function getHighAccuracyLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,  // ← the key fix: forces GPS, not IP lookup
      maximumAge: 0,             // ← never use cached position
      timeout: 10000,            // ← 10 s before giving up
    });
  });
}

// ─── SplitPlanCard ────────────────────────────────────────────────────────────
function SplitPlanCard({match,idx,isFirst,users,onPlaceClick,buildFairnessSummary,generateMeetupFlow,buildExplainPrompt}:{
  match:SplitMatch; idx:number; isFirst:boolean; users:GroupUser[];
  onPlaceClick:(place:EnrichedPlace)=>void;
  buildFairnessSummary:(m:SplitMatch)=>string;
  generateMeetupFlow:(m:SplitMatch,u:GroupUser[])=>string[];
  buildExplainPrompt:(m:SplitMatch,u:GroupUser[])=>string;
}) {
  const [planResult,setPlanResult]=useState<PlanResult|null>(null);
  const [planLoading,setPlanLoading]=useState(false);
  const [planError,setPlanError]=useState("");
  const llmCache=useRef<Map<string,string>>(new Map());
  const isMounted=useRef(true);
  useEffect(()=>{ isMounted.current=true; return()=>{ isMounted.current=false; }; },[]);
  const meetupFlow=planResult?planResult.meetupFlow:generateMeetupFlow(match,users);

  const handleExplain=useCallback(async()=>{
    if(planLoading) return;
    const key=`${match.placeA.tags.name}|${match.placeB.tags.name}|${users.filter(u=>u.location).map(u=>[...u.preferences].sort().join(",")).join("|")}`;
    if(llmCache.current.has(key)){
      setPlanResult({text:llmCache.current.get(key)!,meetupFlow:generateMeetupFlow(match,users),fairnessSummary:buildFairnessSummary(match)});
      return;
    }
    setPlanLoading(true); setPlanError("");
    try {
      const res=await fetch("/api/explain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:buildExplainPrompt(match,users),cacheKey:key})});
      const data=await res.json();
      if(!isMounted.current) return;
      if(!res.ok||data.error){setPlanError(data.error??"Couldn't generate explanation");return;}
      const text=(data.text??"").trim();
      if(!text){setPlanError("Empty response — try again");return;}
      llmCache.current.set(key,text);
      setPlanResult({text,meetupFlow:generateMeetupFlow(match,users),fairnessSummary:buildFairnessSummary(match)});
    } catch { if(isMounted.current) setPlanError("Couldn't reach explanation service. Try again."); }
    finally { if(isMounted.current) setPlanLoading(false); }
  },[match,users,planLoading,buildFairnessSummary,generateMeetupFlow,buildExplainPrompt]);

  useEffect(()=>{
    if(isFirst){const t=setTimeout(handleExplain,500);return()=>clearTimeout(t);}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const userColors=["#C08552","#5E3023","#895737","#3E000C","#8B5E3C"];

  return (
    <div style={{borderRadius:"16px",padding:"14px",background:isFirst?"linear-gradient(135deg,rgba(192,133,82,0.1) 0%,rgba(94,48,35,0.07) 100%)":"rgba(243,233,220,0.45)",border:`1px solid ${isFirst?"rgba(192,133,82,0.4)":"rgba(192,133,82,0.18)"}`,boxShadow:isFirst?"0 6px 24px rgba(192,133,82,0.12)":"none",animation:"slideUp 0.35s cubic-bezier(0.22,1,0.36,1) both",animationDelay:`${idx*60}ms`,flexShrink:0}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
          <span style={{fontSize:"12px"}}>🤝</span>
          <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"13px",fontWeight:400,letterSpacing:"0.06em",color:isFirst?T.caramel:T.coffee,fontStyle:isFirst?"italic":"normal"}}>{isFirst?"Smart Plan":"Alternative"}</span>
          {isFirst&&<span style={{fontSize:"8px",background:"rgba(192,133,82,0.18)",color:T.caramel,padding:"2px 7px",borderRadius:"20px",letterSpacing:"0.1em",textTransform:"uppercase" as const}}>Best</span>}
        </div>
        <span style={{fontSize:"9px",color:"rgba(137,87,55,0.5)",letterSpacing:"0.04em"}}>{Math.round(match.distanceBetween*1000)}m apart</span>
      </div>
      <div style={{display:"flex",flexDirection:"column" as const,gap:"5px",marginBottom:"10px"}}>
        {[match.placeA,match.placeB].map((place,pi)=>(
          <button key={pi} onClick={()=>onPlaceClick(place)} style={{width:"100%",display:"flex",alignItems:"center",gap:"9px",background:"rgba(255,236,209,0.3)",border:"1px solid rgba(192,133,82,0.15)",borderRadius:"10px",padding:"7px 10px",cursor:"pointer",textAlign:"left" as const,transition:"all 0.2s",position:"relative" as const}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,236,209,0.6)";e.currentTarget.style.borderColor="rgba(192,133,82,0.35)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,236,209,0.3)";e.currentTarget.style.borderColor="rgba(192,133,82,0.15)";}}>
            <span style={{fontSize:"15px"}}>{placeEmoji(place)}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:"11px",fontWeight:500,color:T.chocolate,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{place.tags.name}</div>
              <div style={{fontSize:"9px",color:priceColor(place.estimatedCostForTwo),marginTop:"1px"}}>≈ ₹{place.estimatedCostForTwo} · {priceLabel(place.estimatedCostForTwo)}</div>
            </div>
            <a href={mapsUrl(place)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{width:"20px",height:"20px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(192,133,82,0.1)",color:T.coffee,textDecoration:"none",flexShrink:0,transition:"all 0.2s"}} onMouseEnter={e=>{e.currentTarget.style.background=T.caramel;e.currentTarget.style.color=T.sand;}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(192,133,82,0.1)";e.currentTarget.style.color=T.coffee;}}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
            </a>
          </button>
        ))}
      </div>
      <div style={{display:"flex",flexWrap:"wrap" as const,gap:"4px",marginBottom:"9px"}}>
        {users.filter(u=>u.location).map((u,ui)=>{
          const dest=match.assignment[u.id]==="B"?match.placeB:match.placeA;
          return <span key={u.id} style={{fontSize:"9px",padding:"3px 8px",borderRadius:"20px",background:"rgba(255,236,209,0.25)",color:T.coffee,borderLeft:`2px solid ${userColors[ui%userColors.length]}`}}>{u.label} → {placeEmoji(dest)}</span>;
        })}
      </div>
      <div style={{background:"rgba(255,236,209,0.2)",border:"1px solid rgba(192,133,82,0.12)",borderRadius:"9px",padding:"8px 10px",marginBottom:"8px",display:"flex",flexDirection:"column" as const,gap:"3px"}}>
        {meetupFlow.map((step,si)=><div key={si} style={{fontSize:"10px",color:"rgba(137,87,55,0.8)",lineHeight:"1.55"}}>{step}</div>)}
      </div>
      {planResult?.fairnessSummary&&<div style={{fontSize:"9px",color:"rgba(137,87,55,0.55)",marginBottom:"8px",letterSpacing:"0.03em"}}>⚖️ {planResult.fairnessSummary}</div>}
      {planResult?.text?(
        <div style={{display:"flex",flexDirection:"column" as const,gap:"5px"}}>
          <p style={{fontSize:"10px",color:"rgba(94,48,35,0.85)",lineHeight:"1.65",margin:0}}>{planResult.text}</p>
          <button onClick={()=>{setPlanResult(null);handleExplain();}} style={{background:"none",border:"none",fontSize:"9px",color:"rgba(192,133,82,0.55)",cursor:"pointer",textAlign:"left" as const,fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em",padding:0}}>↺ Regenerate</button>
        </div>
      ):planError?(
        <button onClick={handleExplain} disabled={planLoading} style={{width:"100%",padding:"7px",background:"rgba(192,133,82,0.12)",border:"1px solid rgba(192,133,82,0.25)",borderRadius:"8px",fontFamily:"'DM Sans',sans-serif",fontSize:"10px",color:T.caramel,cursor:"pointer",letterSpacing:"0.04em"}}>
          {planLoading?"✦ Thinking…":"✦ Try again"}
        </button>
      ):(
        <button onClick={handleExplain} disabled={planLoading} style={{width:"100%",padding:"7px",background:"rgba(192,133,82,0.12)",border:"1px solid rgba(192,133,82,0.25)",borderRadius:"8px",fontFamily:"'DM Sans',sans-serif",fontSize:"10px",color:T.caramel,cursor:planLoading?"not-allowed":"pointer",letterSpacing:"0.04em",transition:"all 0.2s",opacity:planLoading?0.7:1}}>
          {planLoading?"✦ Thinking…":isFirst?"✦ Explain this plan":"✦ Explain this option"}
        </button>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function MainApp() {
  const router=useRouter();

  // FIX 2: useSession from NextAuth — gives us session.user.name directly
  const { data: session, status } = useSession();

  const [userLocation,setUserLocation]=useState<LatLon|null>(null);
  const [searchLocation,setSearchLocation]=useState<LatLon|null>(null);
  const [locationQuery,setLocationQuery]=useState("");
  const [suggestions,setSuggestions]=useState<MapboxFeature[]>([]);
  const [activeIndex,setActiveIndex]=useState(-1);
  const [searching,setSearching]=useState(false);
  const [radius,setRadius]=useState(2000);
  const [sortBy,setSortBy]=useState<"score"|"distance"|"price">("score");
  const [resultsQuery,setResultsQuery]=useState("");
  const [allPlaces,setAllPlaces]=useState<EnrichedPlace[]>([]);
  const [loading,setLoading]=useState(false);
  const [fetchError,setFetchError]=useState<string|null>(null);
  const [cacheStatus,setCacheStatus]=useState<string>("");
  const [selectedPlace,setSelectedPlace]=useState<EnrichedPlace|null>(null);
  const [shortlist,setShortlist]=useState<EnrichedPlace[]>([]);
  const [activeTab,setActiveTab]=useState<"all"|"shortlist">("all");
  const [groupMode,setGroupMode]=useState(false);
  const [showGroupPanel,setShowGroupPanel]=useState(false);
  const [users,setUsers]=useState<GroupUser[]>([]);
  const [userGeoQuery,setUserGeoQuery]=useState<Record<string,string>>({});
  const [userGeoSugg,setUserGeoSugg]=useState<Record<string,MapboxFeature[]>>({});
  const [prefInput,setPrefInput]=useState<Record<string,string>>({});
  const [mounted,setMounted]=useState(false);
  // FIX 3: track mobile breakpoint reactively
  const [isMobile,setIsMobile]=useState(false);
  // mobile bottom sheet states
  const [mobileSheet,setMobileSheet]=useState<"map"|"list">("map");
  const [showMobileGroup,setShowMobileGroup]=useState(false);

  const suggestionsRef=useRef<HTMLDivElement>(null);
  const inputRef=useRef<HTMLInputElement>(null);
  const suggestDebounce=useRef<ReturnType<typeof setTimeout>|null>(null);
  const userGeoDebounce=useRef<Record<string,ReturnType<typeof setTimeout>>>({});
  const localCache=useRef<Map<string,EnrichedPlace[]>>(new Map());

  useEffect(()=>{ const t=setTimeout(()=>setMounted(true),60); return()=>clearTimeout(t); },[]);

  // FIX 3: listen for window resize to toggle mobile layout
  useEffect(()=>{
    const check=()=>setIsMobile(window.innerWidth<768);
    check();
    window.addEventListener("resize",check);
    return()=>window.removeEventListener("resize",check);
  },[]);

  // Auth guard via NextAuth
  useEffect(()=>{
    if(status==="unauthenticated") router.push("/auth");
  },[status,router]);

  // FIX 2: sign out via NextAuth
  const handleSignOut=useCallback(()=>{
    signOut({ callbackUrl:"/splash" });
  },[]);

  const fetchMapboxPlaces=useCallback(async(lat:number,lon:number):Promise<RawPlace[]>=>{
    if(!MAPBOX_TOKEN) return [];
    const radiusKm=radius/1000;
    const responses=await Promise.all(MAPBOX_CATEGORIES.map(cat=>
      fetch(`https://api.mapbox.com/search/searchbox/v1/category/${cat}?proximity=${lon},${lat}&limit=20&language=en&access_token=${MAPBOX_TOKEN}`)
        .then(r=>r.ok?r.json():null).catch(()=>null)
    ));
    const results:RawPlace[]=[];
    for(const data of responses) {
      if(!data?.features) continue;
      for(const f of data.features) {
        const [fLon,fLat]=f.geometry?.coordinates??[];
        if(!isValidCoord(fLat,fLon)||haversineKm(lat,lon,fLat,fLon)>radiusKm) continue;
        const cats:string[]=f.properties?.poi_category??[];
        const cat=cats.join(", ").toLowerCase();
        let amenity="restaurant";
        if(cat.includes("cafe")||cat.includes("coffee")) amenity="cafe";
        else if(cat.includes("fast food")) amenity="fast_food";
        results.push({lat:fLat,lon:fLon,tags:{name:f.properties?.name??"Unnamed",amenity,cuisine:cats.filter(c=>!["food","restaurant","cafe"].includes(c.toLowerCase())).join(", "),address:f.properties?.full_address??f.properties?.address??""}});
      }
    }
    return results;
  },[radius]);

  const loadPlaces=useCallback(async(centerLat:number,centerLon:number)=>{
    const cacheKey=`${centerLat.toFixed(4)}-${centerLon.toFixed(4)}-${radius}`;
    if(localCache.current.has(cacheKey)){setAllPlaces(localCache.current.get(cacheKey)!);setCacheStatus("LOCAL");return;}
    setLoading(true);setFetchError(null);
    try {
      const places=await fetchMapboxPlaces(centerLat,centerLon);
      if(!places.length){setFetchError("No places found nearby. Try increasing the radius.");setAllPlaces([]);setLoading(false);return;}
      const seen=new Map<string,RawPlace>();
      for(const p of places){
        if(haversineKm(centerLat,centerLon,p.lat,p.lon)>radius/1000) continue;
        const uk=`${p.tags.name?.toLowerCase()}-${p.lat.toFixed(4)}-${p.lon.toFixed(4)}`;
        if(!seen.has(uk)) seen.set(uk,p);
      }
      const enriched=Array.from(seen.values()).map(p=>{
        const distance=haversineKm(centerLat,centerLon,p.lat,p.lon);
        const {cost,source}=estimateCost(p);
        const base:EnrichedPlace={...p,distance,estimatedCostForTwo:cost,priceSource:source as EnrichedPlace["priceSource"],score:0,tags:{...p.tags,name:p.tags?.name||"Unnamed Place"}};
        return {...base,score:computeScore(base)};
      }).filter(p=>p.distance<=radius/1000).sort((a,b)=>b.score-a.score).slice(0,100);
      localCache.current.set(cacheKey,enriched);
      setAllPlaces(enriched);setFetchError(null);setCacheStatus("FRESH");
    } catch { setFetchError("Failed to load places. Please try again.");setAllPlaces([]); }
    finally { setLoading(false); }
  },[fetchMapboxPlaces,radius]);

  const places=useMemo(()=>{
    const list=[...allPlaces];
    if(sortBy==="distance") return list.sort((a,b)=>a.distance-b.distance);
    if(sortBy==="price") return list.sort((a,b)=>a.estimatedCostForTwo-b.estimatedCostForTwo);
    return list.sort((a,b)=>b.score-a.score);
  },[allPlaces,sortBy]);

  const filteredPlaces=useMemo(()=>{
    if(!resultsQuery.trim()) return places;
    const q=resultsQuery.toLowerCase();
    return places.filter(p=>p.tags.name.toLowerCase().includes(q)||(p.tags.cuisine??"").toLowerCase().includes(q));
  },[places,resultsQuery]);

  const groupResults=useMemo(():GroupEnrichedPlace[]=>{
    if(!groupMode) return [];
    const active=users.filter(u=>u.location);
    if(!active.length) return [];
    return allPlaces.map(p=>({...p,...scoreForGroup(p,users)})).sort((a,b)=>b.groupScore-a.groupScore).slice(0,40);
  },[groupMode,users,allPlaces]);

  const splitResults=useMemo(():SplitMatch[]=>{
    if(!groupMode) return [];
    return findSplitMatches(allPlaces,users);
  },[groupMode,allPlaces,users]);

  const shouldUseSplit=useMemo(()=>{
    if(!groupMode||!splitResults.length||!groupResults.length) return false;
    const allPrefs=users.filter(u=>u.location).flatMap(u=>u.preferences);
    return new Set(allPrefs).size>1&&splitResults[0].score>(groupResults[0]?.groupScore??0);
  },[groupMode,splitResults,groupResults,users]);

  const groupCenter=useMemo(()=>{
    const active=users.filter(u=>u.location);
    if(!active.length) return userLocation;
    if(active.length===1) return active[0].location;
    return centroid(active.map(u=>u.location!));
  },[users,userLocation]);

  const mapGroupUsers=useMemo(()=>{
    if(!groupMode) return [];
    return users.filter(u=>u.location!==null).map(u=>({id:u.id,label:u.label,location:u.location!}));
  },[groupMode,users]);

  const mapPlaces=useMemo(()=>groupMode?groupResults:filteredPlaces,[groupMode,groupResults,filteredPlaces]);
  const mapCenter=useMemo(()=>groupMode&&groupCenter?groupCenter:userLocation,[groupMode,groupCenter,userLocation]);
  const activeUserCount=useMemo(()=>users.filter(u=>u.location).length,[users]);
  const displayedItems=useMemo(()=>{
    return activeTab==="shortlist"?shortlist:(groupMode?(shouldUseSplit?splitResults:groupResults):filteredPlaces);
  },[activeTab,shortlist,groupMode,shouldUseSplit,splitResults,groupResults,filteredPlaces]);

  // FIX 2: extract first name from NextAuth session
  const firstName=useMemo(()=>{
    const name=session?.user?.name;
    if(!name) return null;
    return name.split(" ")[0];
  },[session]);

  useEffect(()=>{
    if(!userLocation) return;
    setUsers(prev=>{
      if(prev.find(u=>u.id==="you")) return prev.map(u=>u.id==="you"?{...u,location:userLocation,locationLabel:"Your location"}:u);
      return [{id:"you",label:"You",location:userLocation,locationLabel:"Your location",maxBudget:700,preferences:[]},...prev];
    });
  },[userLocation]);

  useEffect(()=>{
    const target=groupMode&&groupCenter?groupCenter:searchLocation;
    if(target){loadPlaces(target.latitude,target.longitude);return;}
    // FIX 1: use high-accuracy geolocation on initial load too
    getHighAccuracyLocation()
      .then(pos=>{
        const loc={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
        setUserLocation(loc);
        setSearchLocation(loc);
      })
      .catch(()=>setFetchError("Location access denied. Please search for a location."));
  },[searchLocation,loadPlaces,groupMode,groupCenter]);

  useEffect(()=>{
    const fn=(e:MouseEvent)=>{
      if(suggestionsRef.current&&!suggestionsRef.current.contains(e.target as Node)&&!inputRef.current?.contains(e.target as Node)){
        setSuggestions([]);setActiveIndex(-1);
      }
    };
    document.addEventListener("mousedown",fn);
    return()=>document.removeEventListener("mousedown",fn);
  },[]);

  if(status==="loading"){
    return(
      <div style={{height:"100vh",background:T.sand,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"20px"}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;1,300&family=DM+Sans:wght@300;400&display=swap');
          @keyframes brewPulse{0%,100%{opacity:0.4;transform:scale(0.97)}50%{opacity:1;transform:scale(1)}}
          @keyframes dotDance{0%,100%{transform:translateY(0);opacity:0.3}40%{transform:translateY(-5px);opacity:1}}
        `}</style>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"10px",animation:"brewPulse 2s ease-in-out infinite"}}>
          <span style={{fontSize:"38px"}}>☕</span>
          <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"26px",fontWeight:300,letterSpacing:"0.2em",color:T.chocolate}}>EXPRESSO</span>
        </div>
        <div style={{display:"flex",gap:"5px"}}>
          {[0,1,2].map(i=>(
            <span key={i} style={{width:"5px",height:"5px",borderRadius:"50%",background:T.caramel,display:"block",animation:"dotDance 1.4s ease-in-out infinite",animationDelay:`${i*0.2}s`}}/>
          ))}
        </div>
      </div>
    );
  }
  if(status==="unauthenticated") return null;

  // ── helpers ──
  function fetchSuggestions(q:string){
    if(suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if(!q.trim()){setSuggestions([]);return;}
    suggestDebounce.current=setTimeout(async()=>{
      try{const r=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5`);const d=await r.json();setSuggestions(d.features??[]);setActiveIndex(-1);}
      catch{setSuggestions([]);}
    },300);
  }
  function selectSuggestion(s:MapboxFeature){
    const [lon,lat]=s.center;
    setUserLocation({latitude:lat,longitude:lon});setSearchLocation({latitude:lat,longitude:lon});
    setLocationQuery(s.place_name);setSuggestions([]);setActiveIndex(-1);inputRef.current?.focus();
  }
  async function handleSearch(){
    const q=locationQuery.trim();if(!q) return;setSearching(true);
    if(/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(q)){
      const [lat,lon]=q.split(",").map(Number);
      if(isValidCoord(lat,lon)){setUserLocation({latitude:lat,longitude:lon});setSearchLocation({latitude:lat,longitude:lon});}
      setSearching(false);return;
    }
    if(activeIndex>=0&&suggestions[activeIndex]){selectSuggestion(suggestions[activeIndex]);setSearching(false);return;}
    try{
      const r=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
      const d=await r.json();
      if(d.features?.length) selectSuggestion(d.features[0]);
      else setFetchError("Location not found.");
    }catch{setFetchError("Geocoding failed.");}
    setSearching(false);
  }
  function handleKeyDown(e:React.KeyboardEvent<HTMLInputElement>){
    if(e.key==="ArrowDown"){e.preventDefault();if(suggestions.length)setActiveIndex(p=>Math.min(p+1,suggestions.length-1));}
    else if(e.key==="ArrowUp"){e.preventDefault();if(suggestions.length)setActiveIndex(p=>Math.max(p-1,-1));}
    else if(e.key==="Enter"){e.preventDefault();if(activeIndex>=0&&suggestions[activeIndex])selectSuggestion(suggestions[activeIndex]);else handleSearch();}
    else if(e.key==="Escape"){setSuggestions([]);setActiveIndex(-1);}
  }
  // FIX 1: useCurrentLocation also uses high-accuracy mode
  function useCurrentLocation(){
    getHighAccuracyLocation()
      .then(pos=>{
        const loc={latitude:pos.coords.latitude,longitude:pos.coords.longitude};
        setUserLocation(loc);
        setSearchLocation(loc);
        setLocationQuery(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
      })
      .catch(()=>setFetchError("Could not access your location. Please allow location permission."));
  }
  function addGroupUser(){setUsers(p=>[...p,{id:`u${Date.now()}`,label:`Friend ${p.length}`,location:null,locationLabel:"",maxBudget:700,preferences:[]}]);}
  function removeGroupUser(id:string){if(id!=="you")setUsers(p=>p.filter(u=>u.id!==id));}
  function updateUser(id:string,patch:Partial<GroupUser>){setUsers(p=>p.map(u=>u.id===id?{...u,...patch}:u));}
  function addPref(uid:string,pref:string){
    const p=pref.trim().toLowerCase();if(!p) return;
    setUsers(prev=>prev.map(u=>u.id===uid&&!u.preferences.includes(p)?{...u,preferences:[...u.preferences,p]}:u));
    setPrefInput(prev=>({...prev,[uid]:""}));
  }
  function removePref(uid:string,pref:string){setUsers(p=>p.map(u=>u.id===uid?{...u,preferences:u.preferences.filter(x=>x!==pref)}:u));}
  function fetchUserGeoSuggestions(uid:string,q:string){
    if(userGeoDebounce.current[uid]) clearTimeout(userGeoDebounce.current[uid]);
    if(!q.trim()){setUserGeoSugg(p=>({...p,[uid]:[]}));return;}
    userGeoDebounce.current[uid]=setTimeout(async()=>{
      try{const r=await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=4`);const d=await r.json();setUserGeoSugg(p=>({...p,[uid]:d.features??[]}));}
      catch{setUserGeoSugg(p=>({...p,[uid]:[]}));}
    },300);
  }
  function selectUserLocation(uid:string,s:MapboxFeature){
    const [lon,lat]=s.center;
    setUsers(p=>p.map(u=>u.id===uid?{...u,location:{latitude:lat,longitude:lon},locationLabel:s.place_name}:u));
    setUserGeoQuery(p=>({...p,[uid]:s.place_name}));setUserGeoSugg(p=>({...p,[uid]:[]}));
  }
  function toggleShortlist(place:EnrichedPlace){
    const k=placeKey(place);
    setShortlist(prev=>prev.some(x=>placeKey(x)===k)?prev.filter(x=>placeKey(x)!==k):[...prev,place]);
  }
  function isShortlisted(place:EnrichedPlace){return shortlist.some(p=>placeKey(p)===placeKey(place));}
  function handlePlaceClick(place:EnrichedPlace){
    setSelectedPlace({...place});
    if(isMobile) setMobileSheet("map"); // switch to map view on mobile when a place is tapped
  }

  const selStyle={background:"rgba(243,233,220,0.85)",border:"1px solid rgba(192,133,82,0.28)",borderRadius:"9px",padding:"0 26px 0 10px",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:300 as const,color:T.chocolate,outline:"none",cursor:"pointer",appearance:"none" as const,backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23895737'/%3E%3C/svg%3E")`,backgroundRepeat:"no-repeat" as const,backgroundPosition:"right 8px center",height:"34px"};

  // ── Group panel (shared between desktop sidebar and mobile sheet) ──
  const GroupPanelContent = (
    <div className="xscroll" style={{flex:1,overflowY:"auto",padding:"12px",display:"flex",flexDirection:"column" as const,gap:"8px"}}>
      {users.map((user,ui)=>(
        <div key={user.id} style={{background:"rgba(255,255,255,0.5)",border:"1px solid rgba(192,133,82,0.15)",borderRadius:"12px",padding:"10px 12px",animation:"slideUp 0.22s ease-out both",animationDelay:`${ui*35}ms`,flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <input value={user.label} onChange={e=>updateUser(user.id,{label:e.target.value})} style={{background:"transparent",border:"none",borderBottom:"1px solid rgba(192,133,82,0.25)",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:500,color:T.chocolate,width:"90px",outline:"none",padding:"1px 0",transition:"border-color 0.2s"}} onFocus={e=>{e.currentTarget.style.borderBottomColor=T.caramel;}} onBlur={e=>{e.currentTarget.style.borderBottomColor="rgba(192,133,82,0.25)";}}/>
            {user.id!=="you"&&<button onClick={()=>removeGroupUser(user.id)} style={{background:"none",border:"none",cursor:"pointer",color:"rgba(158,58,58,0.35)",fontSize:"13px",lineHeight:"1",padding:0,transition:"color 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.color="#9e3a3a";}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(158,58,58,0.35)";}}>✕</button>}
          </div>
          <div style={{position:"relative",marginBottom:"6px"}}>
            <input type="text" placeholder={user.id==="you"?"Your location…":"Their location…"} value={userGeoQuery[user.id]??user.locationLabel} onChange={e=>{setUserGeoQuery(p=>({...p,[user.id]:e.target.value}));fetchUserGeoSuggestions(user.id,e.target.value);}} style={{width:"100%",background:"rgba(243,233,220,0.7)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"7px",padding:"5px 22px 5px 8px",fontFamily:"'DM Sans',sans-serif",fontSize:"10px",fontWeight:300,color:T.chocolate,outline:"none",transition:"all 0.18s"}} onFocus={e=>{e.currentTarget.style.borderColor=T.caramel;e.currentTarget.style.background=T.sand;}} onBlur={e=>{e.currentTarget.style.borderColor="rgba(192,133,82,0.2)";e.currentTarget.style.background="rgba(243,233,220,0.7)";}}/>
            {user.location&&<span style={{position:"absolute",right:"7px",top:"50%",transform:"translateY(-50%)",fontSize:"9px",color:T.green}}>✓</span>}
            {userGeoSugg[user.id]?.length>0&&(
              <div style={{position:"absolute",top:"calc(100% + 2px)",left:0,right:0,zIndex:50,background:T.sand,border:"1px solid rgba(192,133,82,0.2)",borderRadius:"8px",overflow:"hidden",boxShadow:"0 4px 16px rgba(62,0,12,0.1)",maxHeight:"108px",overflowY:"auto"}}>
                {userGeoSugg[user.id].map(s=>(
                  <button key={s.place_name} onMouseDown={e=>{e.preventDefault();selectUserLocation(user.id,s);}} style={{width:"100%",textAlign:"left" as const,padding:"6px 10px",background:"none",border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:"10px",color:T.coffee,cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const,display:"block",transition:"background 0.1s"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(192,133,82,0.08)";}} onMouseLeave={e=>{e.currentTarget.style.background="none";}}>{s.place_name}</button>
                ))}
              </div>
            )}
          </div>
          <select value={user.maxBudget} onChange={e=>updateUser(user.id,{maxBudget:Number(e.target.value)})} style={{width:"100%",background:"rgba(243,233,220,0.7)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"7px",padding:"4px 8px",fontFamily:"'DM Sans',sans-serif",fontSize:"10px",color:T.chocolate,outline:"none",cursor:"pointer",marginBottom:"6px"}} onFocus={e=>{e.currentTarget.style.borderColor=T.caramel;}}>
            {BUDGET_OPTIONS.map(b=><option key={b} value={b}>₹{b} budget</option>)}
          </select>
          {user.preferences.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap" as const,gap:"3px",marginBottom:"6px"}}>
              {user.preferences.map(p=>(
                <span key={p} style={{display:"inline-flex",alignItems:"center",gap:"3px",background:"rgba(192,133,82,0.1)",color:T.brownie,fontSize:"9px",padding:"2px 7px",borderRadius:"20px"}}>
                  {p}<button onClick={()=>removePref(user.id,p)} style={{background:"none",border:"none",color:"rgba(137,87,55,0.45)",cursor:"pointer",fontSize:"10px",lineHeight:"1",padding:0,transition:"color 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.color=T.caramel;}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(137,87,55,0.45)";}}>×</button>
                </span>
              ))}
            </div>
          )}
          <input type="text" placeholder="Add preference…" value={prefInput[user.id]??""} onChange={e=>setPrefInput(p=>({...p,[user.id]:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")addPref(user.id,prefInput[user.id]??"");}} style={{width:"100%",background:"rgba(243,233,220,0.7)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"7px",padding:"4px 8px",fontFamily:"'DM Sans',sans-serif",fontSize:"10px",fontWeight:300,color:T.chocolate,outline:"none",marginBottom:"5px",transition:"all 0.18s"}} onFocus={e=>{e.currentTarget.style.borderColor=T.caramel;e.currentTarget.style.background=T.sand;}} onBlur={e=>{e.currentTarget.style.borderColor="rgba(192,133,82,0.2)";e.currentTarget.style.background="rgba(243,233,220,0.7)";}}/>
          <div style={{display:"flex",flexWrap:"wrap" as const,gap:"3px"}}>
            {PREF_SUGGESTIONS.slice(0,5).map(s=>(
              <button key={s} onClick={()=>addPref(user.id,s)} style={{fontSize:"9px",color:"rgba(137,87,55,0.45)",background:"rgba(255,255,255,0.35)",border:"none",borderRadius:"20px",padding:"2px 7px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.color=T.caramel;e.currentTarget.style.background="rgba(192,133,82,0.1)";}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(137,87,55,0.45)";e.currentTarget.style.background="rgba(255,255,255,0.35)";}}>+{s}</button>
            ))}
          </div>
        </div>
      ))}
      <button onClick={addGroupUser} style={{width:"100%",padding:"9px",background:"none",border:"1px dashed rgba(192,133,82,0.3)",borderRadius:"10px",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:300,color:"rgba(137,87,55,0.55)",cursor:"pointer",transition:"all 0.2s",letterSpacing:"0.04em",flexShrink:0}} onMouseEnter={e=>{e.currentTarget.style.borderColor=T.caramel;e.currentTarget.style.color=T.caramel;e.currentTarget.style.background="rgba(192,133,82,0.04)";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(192,133,82,0.3)";e.currentTarget.style.color="rgba(137,87,55,0.55)";e.currentTarget.style.background="none";}}>
        + Add person
      </button>
      {groupCenter&&activeUserCount>=2&&(
        <div style={{textAlign:"center",fontSize:"9px",color:"rgba(137,87,55,0.4)",letterSpacing:"0.06em",fontWeight:300,flexShrink:0}}>📍 Searching from group centroid</div>
      )}
    </div>
  );

  // ── Results list (shared) ──
  const ResultsList = (
    <div className="xscroll" style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column" as const,gap:"7px",paddingRight:"1px",minHeight:0}}>
      {loading?(
        [...Array(5)].map((_,i)=>(
          <div key={i} style={{height:"82px",borderRadius:"14px",background:"linear-gradient(90deg,rgba(192,133,82,0.07) 25%,rgba(192,133,82,0.13) 50%,rgba(192,133,82,0.07) 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.4s ease-in-out infinite",animationDelay:`${i*90}ms`,flexShrink:0}}/>
        ))
      ):displayedItems.length===0?(
        <div style={{textAlign:"center",padding:"34px 18px",background:"rgba(255,236,209,0.3)",border:"1px dashed rgba(192,133,82,0.18)",borderRadius:"16px",animation:"fadeIn 0.3s ease-out",flexShrink:0}}>
          <div style={{fontSize:"28px",marginBottom:"10px",opacity:0.55}}>{activeTab==="shortlist"?"⭐":groupMode?"👥":"📍"}</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"16px",fontWeight:300,color:T.chocolate,marginBottom:"7px",letterSpacing:"0.04em"}}>
            {activeTab==="shortlist"?"No saved places":groupMode?"Set up your group":"No places found"}
          </div>
          <div style={{fontSize:"11px",fontWeight:300,color:"rgba(137,87,55,0.58)",lineHeight:"1.65",letterSpacing:"0.02em"}}>
            {activeTab==="shortlist"?"Tap ☆ on any place to save it for later.":groupMode?"Add locations and preferences for each person.":resultsQuery?`Nothing matched "${resultsQuery}". Try a broader search.`:"Try increasing the radius or searching a different area."}
          </div>
        </div>
      ):(
        (displayedItems as any[]).map((item,idx)=>{
          if(item.placeA){
            return <SplitPlanCard key={`split-${idx}`} match={item} idx={idx} isFirst={idx===0} users={users} onPlaceClick={handlePlaceClick} buildFairnessSummary={()=>"Balanced for everyone"} generateMeetupFlow={generateMeetupFlow} buildExplainPrompt={buildExplainPrompt}/>;
          }
          const place=item as EnrichedPlace;
          const added=isShortlisted(place);
          const isSel=!!(selectedPlace&&placeKey(selectedPlace)===placeKey(place));
          return(
            <div key={placeKey(place)} onClick={()=>handlePlaceClick(place)} className={`place-card${isSel?" sel":""}`}
              style={{background:"rgba(255,255,255,0.55)",border:`1px solid ${isSel?T.caramel:"rgba(192,133,82,0.18)"}`,borderRadius:"14px",padding:"11px 13px",cursor:"pointer",overflow:"hidden",transition:"background 0.2s,border-color 0.22s,box-shadow 0.22s,transform 0.2s cubic-bezier(0.22,1,0.36,1)",userSelect:"none" as const,animation:"slideUp 0.3s cubic-bezier(0.22,1,0.36,1) both",animationDelay:`${Math.min(idx*25,280)}ms`,boxShadow:isSel?"0 4px 18px rgba(192,133,82,0.15)":"none",flexShrink:0}}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,236,209,0.65)";e.currentTarget.style.borderColor=isSel?T.caramel:"rgba(192,133,82,0.35)";e.currentTarget.style.transform="translateY(-2px) scale(1.005)";e.currentTarget.style.boxShadow="0 6px 20px rgba(62,0,12,0.09)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.55)";e.currentTarget.style.borderColor=isSel?T.caramel:"rgba(192,133,82,0.18)";e.currentTarget.style.transform="translateY(0) scale(1)";e.currentTarget.style.boxShadow=isSel?"0 4px 18px rgba(192,133,82,0.15)":"none";}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"8px"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:"7px",marginBottom:"2px"}}>
                    <span style={{fontSize:"15px",flexShrink:0}}>{placeEmoji(place)}</span>
                    <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"12px",fontWeight:500,color:T.chocolate,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"normal",wordBreak:"break-word" as const,lineHeight:"1.3"}}>{place.tags.name}</span>
                  </div>
                  {place.tags.cuisine&&<div style={{fontSize:"10px",color:T.coffee,marginTop:"1px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const,textTransform:"capitalize" as const,letterSpacing:"0.02em",paddingLeft:"22px"}}>{place.tags.cuisine}</div>}
                  <div style={{display:"flex",alignItems:"center",gap:"9px",marginTop:"6px",fontSize:"11px",color:T.coffee,paddingLeft:"22px"}}>
                    <span style={{fontSize:"10px"}}>📍 {place.distance.toFixed(2)} km</span>
                    <span style={{fontWeight:500,color:priceColor(place.estimatedCostForTwo)}}>≈ ₹{place.estimatedCostForTwo}</span>
                    <span style={{color:"rgba(137,87,55,0.38)",fontSize:"10px"}}>{priceLabel(place.estimatedCostForTwo)}</span>
                  </div>
                  {place.tags.address&&<div style={{fontSize:"9px",color:"rgba(137,87,55,0.48)",marginTop:"3px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const,letterSpacing:"0.02em",paddingLeft:"22px"}}>{place.tags.address}</div>}
                </div>
                <button onClick={e=>{e.stopPropagation();toggleShortlist(place);}} style={{background:"none",border:"none",fontSize:"17px",cursor:"pointer",transition:"transform 0.15s,color 0.15s",padding:"3px",margin:"-3px -3px 0 0",lineHeight:"1",flexShrink:0,color:added?T.caramel:"rgba(137,87,55,0.28)"}} onMouseEnter={e=>{e.currentTarget.style.color=added?T.caramel:"rgba(192,133,82,0.6)";}} onMouseLeave={e=>{e.currentTarget.style.color=added?T.caramel:"rgba(137,87,55,0.28)";}} onMouseDown={e=>{e.currentTarget.style.transform="scale(0.7)";}} onMouseUp={e=>{e.currentTarget.style.transform="scale(1)";}}>
                  {added?"⭐":"☆"}
                </button>
              </div>
              <div style={{display:"flex",justifyContent:"flex-end",marginTop:"5px"}}>
                <a href={mapsUrl(place)} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{display:"inline-flex",alignItems:"center",gap:"3px",fontSize:"9px",color:"rgba(192,133,82,0.4)",textDecoration:"none",transition:"color 0.18s",letterSpacing:"0.06em"}} onMouseEnter={e=>{e.currentTarget.style.color=T.caramel;}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(192,133,82,0.4)";}}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>
                  Directions
                </a>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return(
    <div style={{height:"100vh",background:T.cream,display:"flex",flexDirection:"column" as const,overflow:"hidden",fontFamily:"'DM Sans',sans-serif"}}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .xscroll::-webkit-scrollbar{width:3px;} .xscroll::-webkit-scrollbar-track{background:transparent;} .xscroll::-webkit-scrollbar-thumb{background:rgba(192,133,82,0.35);border-radius:4px;} .xscroll::-webkit-scrollbar-thumb:hover{background:#C08552;}
        @keyframes headerIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes panelIn{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:translateX(0)}}
        @keyframes groupIn{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
        @keyframes sheetUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
        @keyframes markerPop{0%{opacity:0;transform:scale(0.4) translateY(8px)}65%{opacity:1;transform:scale(1.12) translateY(-2px)}100%{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes markerRipple{0%{box-shadow:0 0 0 0 rgba(192,133,82,0.5),0 3px 10px rgba(62,0,12,0.25)}70%{box-shadow:0 0 0 10px rgba(192,133,82,0),0 3px 10px rgba(62,0,12,0.25)}100%{box-shadow:0 0 0 0 rgba(192,133,82,0),0 3px 10px rgba(62,0,12,0.25)}}
        .mapboxgl-marker{animation:markerPop 0.4s cubic-bezier(0.22,1,0.36,1) both !important;transition:transform 0.2s cubic-bezier(0.22,1,0.36,1) !important;will-change:transform;}
        .mapboxgl-marker:hover{transform:scale(1.15) translateY(-3px) !important;z-index:10 !important;}
        .exp-pin{width:34px;height:44px;position:relative;cursor:pointer;animation:markerPop 0.38s cubic-bezier(0.22,1,0.36,1) both;filter:drop-shadow(0 3px 7px rgba(62,0,12,0.28));transition:transform 0.2s cubic-bezier(0.22,1,0.36,1),filter 0.2s;}
        .exp-pin:hover{transform:scale(1.18) translateY(-3px);filter:drop-shadow(0 5px 12px rgba(62,0,12,0.35));}
        .exp-pin.exp-pin--selected{transform:scale(1.22) translateY(-4px);filter:drop-shadow(0 6px 16px rgba(192,133,82,0.55));}
        .exp-pin .pin-body{transition:fill 0.2s;} .exp-pin:hover .pin-body,.exp-pin.exp-pin--selected .pin-body{fill:#C08552 !important;}
        .exp-pin .pin-icon{position:absolute;top:5px;left:50%;transform:translateX(-50%);font-size:14px;line-height:1;pointer-events:none;user-select:none;}
        .exp-user-dot{width:16px;height:16px;border-radius:50%;background:#C08552;border:3px solid #FFECD1;animation:markerRipple 2s ease-out infinite;box-shadow:0 2px 8px rgba(62,0,12,0.3);}
        .exp-group-marker{min-width:28px;height:28px;border-radius:14px;padding:0 8px;background:#3E000C;border:2px solid #FFECD1;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;font-size:9px;font-weight:500;color:#FFECD1;letter-spacing:0.03em;white-space:nowrap;box-shadow:0 2px 8px rgba(62,0,12,0.3);animation:markerPop 0.38s cubic-bezier(0.22,1,0.36,1) both;cursor:default;}
        .place-card{position:relative;} .place-card::before{content:'';position:absolute;left:0;top:14px;bottom:14px;width:3px;background:transparent;border-radius:0 3px 3px 0;transition:background 0.22s;} .place-card:hover::before{background:rgba(192,133,82,0.45);} .place-card.sel::before{background:#C08552;}
        button:focus-visible,select:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #C08552;outline-offset:2px;}
      `}</style>

      {/* ─── HEADER ─────────────────────────────────────────────────── */}
      <header style={{flexShrink:0,padding:isMobile?"8px 14px":"10px 20px",background:"rgba(255,236,209,0.97)",backdropFilter:"blur(16px)",borderBottom:"1px solid rgba(192,133,82,0.2)",boxShadow:"0 2px 16px rgba(62,0,12,0.06)",position:"relative",zIndex:30,animation:mounted?"headerIn 0.55s cubic-bezier(0.22,1,0.36,1) both":"none"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent 0%,rgba(192,133,82,0.45) 50%,transparent 100%)"}}/>

        <div style={{maxWidth:"1400px",margin:"0 auto",display:"flex",alignItems:"center",gap:isMobile?"8px":"14px",flexWrap:"wrap" as const,rowGap:"6px"}}>

          {/* FIX 2: Logo — Cormorant Garamond italic matching splash/auth, with greeting */}
          <div style={{display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
            <div style={{position:"relative",width:"26px",height:"26px",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{position:"absolute",inset:0,borderRadius:"50%",background:"rgba(192,133,82,0.1)",border:"1px solid rgba(192,133,82,0.2)"}}/>
              <span style={{fontSize:"14px",position:"relative"}}>☕</span>
            </div>
            {/* Matches splash: Cormorant Garamond, weight 300, italic, wide tracking */}
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontWeight:300,fontStyle:"italic",fontSize:isMobile?"18px":"22px",letterSpacing:"0.14em",color:T.chocolate,lineHeight:"1",textTransform:"uppercase" as const}}>
              Expr<span style={{color:T.caramel,fontStyle:"normal"}}>e</span>sso
            </span>
            {/* FIX 2: Greeting — shows only if session name exists, styled delicately */}
            {firstName&&(
              <div style={{display:"flex",flexDirection:"column" as const,justifyContent:"center",borderLeft:`1px solid rgba(192,133,82,0.25)`,paddingLeft:"10px",marginLeft:"2px"}}>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:"9px",fontWeight:300,letterSpacing:"0.18em",textTransform:"uppercase" as const,color:"rgba(137,87,55,0.45)",lineHeight:"1.2"}}>Welcome back</span>
                <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"14px",fontWeight:300,letterSpacing:"0.06em",color:T.brownie,lineHeight:"1.2"}}>{firstName}</span>
              </div>
            )}
          </div>

          {/* Search — full width on mobile */}
          <div style={{flex:1,position:"relative",display:"flex",gap:"8px",alignItems:"center",minWidth:isMobile?"0":"180px",width:isMobile?"100%":"auto",order:isMobile?10:0}}>
            <div style={{position:"relative",flex:1}}>
              <span style={{position:"absolute",left:"11px",top:"50%",transform:"translateY(-50%)",fontSize:"13px",pointerEvents:"none",opacity:0.45}}>🔍</span>
              <input ref={inputRef} type="text" placeholder="Search area or city…" value={locationQuery}
                onChange={e=>{setLocationQuery(e.target.value);fetchSuggestions(e.target.value);}}
                onKeyDown={handleKeyDown}
                style={{width:"100%",height:"34px",background:"rgba(243,233,220,0.8)",border:"1px solid rgba(192,133,82,0.25)",borderRadius:"10px",padding:"0 14px 0 34px",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",fontWeight:300,color:T.chocolate,outline:"none",transition:"all 0.22s"}}
                onFocus={e=>{e.currentTarget.style.borderColor=T.caramel;e.currentTarget.style.boxShadow="0 0 0 3px rgba(192,133,82,0.1)";e.currentTarget.style.background=T.sand;}}
                onBlur={e=>{e.currentTarget.style.borderColor="rgba(192,133,82,0.25)";e.currentTarget.style.boxShadow="none";e.currentTarget.style.background="rgba(243,233,220,0.8)";}}
              />
              {suggestions.length>0&&(
                <div ref={suggestionsRef} style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:60,background:T.sand,border:"1px solid rgba(192,133,82,0.25)",borderRadius:"12px",overflow:"hidden",boxShadow:"0 12px 40px rgba(62,0,12,0.13)",animation:"slideUp 0.16s ease-out"}}>
                  {suggestions.map((s,i)=>(
                    <button key={s.place_name} onMouseDown={e=>{e.preventDefault();selectSuggestion(s);}} style={{width:"100%",textAlign:"left" as const,padding:"9px 14px",background:i===activeIndex?"rgba(192,133,82,0.1)":"none",border:"none",borderBottom:i<suggestions.length-1?"1px solid rgba(192,133,82,0.07)":"none",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",fontWeight:300,color:i===activeIndex?T.chocolate:T.coffee,cursor:"pointer",transition:"background 0.12s,color 0.12s",display:"block"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(192,133,82,0.08)";e.currentTarget.style.color=T.chocolate;}} onMouseLeave={e=>{e.currentTarget.style.background=i===activeIndex?"rgba(192,133,82,0.1)":"none";e.currentTarget.style.color=i===activeIndex?T.chocolate:T.coffee;}}>{s.place_name}</button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleSearch} disabled={searching} style={{height:"34px",padding:"0 14px",background:T.chocolate,color:T.sand,border:"none",borderRadius:"10px",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",fontWeight:400,letterSpacing:"0.06em",cursor:"pointer",transition:"background 0.2s,transform 0.15s",whiteSpace:"nowrap" as const}} onMouseEnter={e=>{if(!searching)e.currentTarget.style.background=T.brownie;}} onMouseLeave={e=>{e.currentTarget.style.background=T.chocolate;}} onMouseDown={e=>{e.currentTarget.style.transform="scale(0.97)";}} onMouseUp={e=>{e.currentTarget.style.transform="scale(1)";}}>
              {searching?"…":"Go"}
            </button>
            <button onClick={useCurrentLocation} title="Use my location" style={{width:"34px",height:"34px",flexShrink:0,background:"rgba(243,233,220,0.8)",border:"1px solid rgba(192,133,82,0.25)",borderRadius:"10px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",cursor:"pointer",transition:"all 0.18s"}} onMouseEnter={e=>{e.currentTarget.style.background=T.sand;e.currentTarget.style.borderColor="rgba(192,133,82,0.5)";}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(243,233,220,0.8)";e.currentTarget.style.borderColor="rgba(192,133,82,0.25)";}}>
              🧭
            </button>
          </div>

          {/* Controls row */}
          <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0,flexWrap:"wrap" as const,rowGap:"6px"}}>
            {/* Group toggle */}
            <button onClick={()=>{setGroupMode(!groupMode);if(!groupMode){if(isMobile)setShowMobileGroup(true);else setShowGroupPanel(true);}}} style={{height:"34px",padding:"0 10px",background:groupMode?"rgba(192,133,82,0.12)":"none",border:`1px solid ${groupMode?T.caramel:"rgba(192,133,82,0.28)"}`,borderRadius:"9px",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:400,letterSpacing:"0.04em",color:groupMode?T.brownie:T.coffee,cursor:"pointer",transition:"all 0.2s",whiteSpace:"nowrap" as const}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(192,133,82,0.1)";e.currentTarget.style.borderColor=T.caramel;e.currentTarget.style.color=T.brownie;}} onMouseLeave={e=>{e.currentTarget.style.background=groupMode?"rgba(192,133,82,0.12)":"none";e.currentTarget.style.borderColor=groupMode?T.caramel:"rgba(192,133,82,0.28)";e.currentTarget.style.color=groupMode?T.brownie:T.coffee;}}>
              {groupMode ? "👥 Group" : "👤 Solo"}
            </button>

            {/* Sign out */}
            <button onClick={handleSignOut} style={{height:"34px",padding:"0 10px",background:"none",border:"1px solid rgba(158,58,58,0.22)",borderRadius:"9px",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:400,color:"#9e3a3a",cursor:"pointer",transition:"all 0.2s",whiteSpace:"nowrap" as const}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(158,58,58,0.07)";e.currentTarget.style.borderColor="rgba(158,58,58,0.45)";}} onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.borderColor="rgba(158,58,58,0.22)";}}>
              🚪 Sign out
            </button>

            {/* Sort + radius — hide on mobile to save space, accessible via sheet */}
            {!isMobile&&<>
              <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                <span style={{fontSize:"9px",fontWeight:300,letterSpacing:"0.14em",textTransform:"uppercase" as const,color:"rgba(137,87,55,0.5)",whiteSpace:"nowrap" as const}}>Sort</span>
                <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} style={selStyle}>
                  <option value="score">✦ Best</option>
                  <option value="distance">📍 Near</option>
                  <option value="price">₹ Price</option>
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
                <span style={{fontSize:"9px",fontWeight:300,letterSpacing:"0.14em",textTransform:"uppercase" as const,color:"rgba(137,87,55,0.5)",whiteSpace:"nowrap" as const}}>Radius</span>
                <select value={radius} onChange={e=>setRadius(Number(e.target.value))} style={selStyle}>
                  <option value={1000}>1 km</option>
                  <option value={2000}>2 km</option>
                  <option value={4000}>4 km</option>
                  <option value={6000}>6 km</option>
                  <option value={10000}>10 km</option>
                </select>
              </div>
            </>}
          </div>
        </div>

        {fetchError&&(
          <div style={{maxWidth:"1400px",margin:"8px auto 0"}}>
            <div style={{background:"rgba(158,58,58,0.07)",border:"1px solid rgba(158,58,58,0.2)",borderRadius:"9px",padding:"8px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"12px",fontWeight:300,color:"#7a3535",gap:"8px",animation:"slideUp 0.2s ease-out"}}>
              <span>⚠ {fetchError}</span>
              <button onClick={()=>setFetchError(null)} style={{background:"none",border:"none",fontSize:"14px",color:"rgba(158,58,58,0.4)",cursor:"pointer",lineHeight:"1",padding:0,transition:"color 0.15s"}} onMouseEnter={e=>{e.currentTarget.style.color="rgba(158,58,58,0.75)";}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(158,58,58,0.4)";}}>✕</button>
            </div>
          </div>
        )}
      </header>

      {/* ─── DESKTOP LAYOUT ────────────────────────────────────────── */}
      {!isMobile&&(
        <div style={{flex:1,display:"flex",overflow:"hidden",padding:"14px 20px",gap:"12px",maxWidth:"1400px",width:"100%",margin:"0 auto",minHeight:0}}>
          {/* Map */}
          <div style={{flex:1,borderRadius:"18px",overflow:"hidden",border:"1px solid rgba(192,133,82,0.2)",boxShadow:"0 4px 28px rgba(62,0,12,0.09)",position:"relative",animation:"fadeIn 0.5s ease-out 0.2s both"}}>
            {mapCenter?<MapView places={mapPlaces} userLocation={mapCenter} selectedPlace={selectedPlace} onSelectPlace={handlePlaceClick} groupMode={groupMode} groupUsers={mapGroupUsers}/>:loading?(<div style={{height:"100%",background:"rgba(243,233,220,0.4)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:"70%",height:"50%",background:"linear-gradient(90deg,rgba(192,133,82,0.07) 25%,rgba(192,133,82,0.14) 50%,rgba(192,133,82,0.07) 75%)",backgroundSize:"200% 100%",borderRadius:"16px",animation:"shimmer 1.4s ease-in-out infinite"}}/></div>):(<div style={{height:"100%",display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",background:"rgba(243,233,220,0.45)",gap:"12px"}}><span style={{fontSize:"36px",opacity:0.4}}>🗺️</span><span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"18px",fontWeight:300,color:T.coffee,letterSpacing:"0.06em"}}>Waiting for location…</span><span style={{fontSize:"11px",color:"rgba(137,87,55,0.45)",fontWeight:300,letterSpacing:"0.04em"}}>Allow location access or search above</span></div>)}
            <div style={{position:"absolute",inset:0,borderRadius:"18px",boxShadow:"inset 0 0 0 1px rgba(192,133,82,0.1)",pointerEvents:"none"}}/>
          </div>
          {/* Right column */}
          <div style={{display:"flex",gap:"10px",minWidth:0,height:"100%",overflow:"hidden"}}>
            {groupMode&&!showGroupPanel&&(
              <button onClick={()=>setShowGroupPanel(true)} style={{width:"36px",flexShrink:0,alignSelf:"flex-start",background:"rgba(192,133,82,0.08)",border:"1px solid rgba(192,133,82,0.25)",borderRadius:"12px",height:"72px",display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",gap:"5px",cursor:"pointer",transition:"all 0.2s",position:"relative" as const,animation:"panelIn 0.25s ease-out"}} onMouseEnter={e=>{e.currentTarget.style.background="rgba(192,133,82,0.14)";e.currentTarget.style.borderColor=T.caramel;}} onMouseLeave={e=>{e.currentTarget.style.background="rgba(192,133,82,0.08)";e.currentTarget.style.borderColor="rgba(192,133,82,0.25)";}}>
                <span style={{fontSize:"14px"}}>👥</span>
                {activeUserCount>1&&<span style={{width:"16px",height:"16px",background:T.caramel,borderRadius:"50%",fontSize:"9px",display:"flex",alignItems:"center",justifyContent:"center",color:T.sand,fontWeight:500}}>{activeUserCount}</span>}
              </button>
            )}
            {groupMode&&showGroupPanel&&(
              <div style={{width:"230px",flexShrink:0,height:"100%",background:T.sand,border:"1px solid rgba(192,133,82,0.2)",borderRadius:"16px",boxShadow:"0 4px 28px rgba(62,0,12,0.09)",display:"flex",flexDirection:"column" as const,overflow:"hidden",animation:"groupIn 0.28s cubic-bezier(0.22,1,0.36,1) both"}}>
                <div style={{background:T.chocolate,padding:"13px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,position:"relative" as const,overflow:"hidden"}}>
                  <div style={{position:"absolute",inset:0,opacity:0.03,backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,pointerEvents:"none"}}/>
                  <span style={{fontFamily:"'Cormorant Garamond',serif",fontWeight:300,fontStyle:"italic",fontSize:"15px",letterSpacing:"0.1em",color:T.sand,position:"relative"}}>Group Setup</span>
                  <button onClick={()=>setShowGroupPanel(false)} style={{background:"none",border:"none",color:"rgba(255,236,209,0.4)",fontSize:"15px",cursor:"pointer",transition:"color 0.15s",lineHeight:"1",padding:"2px",position:"relative"}} onMouseEnter={e=>{e.currentTarget.style.color=T.sand;}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,236,209,0.4)";}}>✕</button>
                </div>
                {GroupPanelContent}
              </div>
            )}
            {/* Results panel */}
            <div style={{width:"300px",display:"flex",flexDirection:"column" as const,gap:"8px",height:"100%",overflow:"hidden",animation:"panelIn 0.35s cubic-bezier(0.22,1,0.36,1) 0.12s both"}}>
              <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                <div style={{flex:1,background:"rgba(243,233,220,0.7)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"10px",padding:"3px",display:"flex",gap:"2px"}}>
                  {(["all","shortlist"] as const).map(tab=>(
                    <button key={tab} onClick={()=>setActiveTab(tab)} style={{flex:1,padding:"7px 0",border:"none",borderRadius:"8px",background:activeTab===tab?T.chocolate:"none",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:400,letterSpacing:"0.04em",color:activeTab===tab?T.sand:"rgba(137,87,55,0.65)",cursor:"pointer",transition:"all 0.22s cubic-bezier(0.22,1,0.36,1)",whiteSpace:"nowrap" as const,boxShadow:activeTab===tab?"0 2px 8px rgba(62,0,12,0.18)":"none"}} onMouseEnter={e=>{if(activeTab!==tab){e.currentTarget.style.background="rgba(192,133,82,0.08)";e.currentTarget.style.color=T.chocolate;}}} onMouseLeave={e=>{if(activeTab!==tab){e.currentTarget.style.background="none";e.currentTarget.style.color="rgba(137,87,55,0.65)";}}}>{tab==="all"?`✦ All${!loading?` (${displayedItems.length})`:""}`:`⭐ Saved (${shortlist.length})`}</button>
                  ))}
                </div>
                {cacheStatus&&<span style={{fontSize:"9px",padding:"3px 7px",borderRadius:"6px",flexShrink:0,background:cacheStatus==="LOCAL"?"rgba(74,124,89,0.12)":"rgba(192,133,82,0.1)",color:cacheStatus==="LOCAL"?T.green:T.coffee,border:`1px solid ${cacheStatus==="LOCAL"?"rgba(74,124,89,0.2)":"rgba(192,133,82,0.2)"}`,letterSpacing:"0.04em"}}>{cacheStatus==="LOCAL"?"💾":"🌐"}</span>}
              </div>
              {activeTab==="all"&&!groupMode&&(
                <input type="text" placeholder="🔍 Filter by name or cuisine…" value={resultsQuery} onChange={e=>setResultsQuery(e.target.value)} style={{width:"100%",background:"rgba(255,255,255,0.45)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"9px",padding:"7px 12px",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",fontWeight:300,color:T.chocolate,outline:"none",transition:"all 0.2s",flexShrink:0}} onFocus={e=>{e.currentTarget.style.borderColor=T.caramel;e.currentTarget.style.background="rgba(255,236,209,0.5)";e.currentTarget.style.boxShadow="0 0 0 3px rgba(192,133,82,0.08)";}} onBlur={e=>{e.currentTarget.style.borderColor="rgba(192,133,82,0.2)";e.currentTarget.style.background="rgba(255,255,255,0.45)";e.currentTarget.style.boxShadow="none";}}/>
              )}
              {groupMode&&activeTab==="all"&&(
                <div style={{fontSize:"10px",fontWeight:300,borderRadius:"9px",padding:"7px 12px",letterSpacing:"0.03em",lineHeight:"1.4",background:shouldUseSplit?"rgba(192,133,82,0.1)":"rgba(243,233,220,0.7)",border:`1px solid ${shouldUseSplit?"rgba(192,133,82,0.3)":"rgba(192,133,82,0.18)"}`,color:shouldUseSplit?T.brownie:T.coffee,flexShrink:0}}>
                  {shouldUseSplit?`🤝 Smart split for ${activeUserCount} — different tastes`:`👥 ${activeUserCount} ${activeUserCount===1?"person":"people"} · fair distance`}
                </div>
              )}
              {ResultsList}
            </div>
          </div>
        </div>
      )}

      {/* ─── MOBILE LAYOUT ─────────────────────────────────────────── */}
      {isMobile&&(
        <div style={{flex:1,display:"flex",flexDirection:"column" as const,overflow:"hidden",position:"relative"}}>
          {/* Full-screen map */}
          <div style={{flex:1,position:"relative"}}>
            {mapCenter?<MapView places={mapPlaces} userLocation={mapCenter} selectedPlace={selectedPlace} onSelectPlace={handlePlaceClick} groupMode={groupMode} groupUsers={mapGroupUsers}/>:(<div style={{height:"100%",display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center",background:"rgba(243,233,220,0.45)",gap:"12px"}}><span style={{fontSize:"36px",opacity:0.4}}>🗺️</span><span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:"18px",fontWeight:300,color:T.coffee,letterSpacing:"0.06em"}}>Waiting for location…</span></div>)}

            {/* Mobile sort/radius controls floating on map */}
            <div style={{position:"absolute",top:"10px",right:"10px",display:"flex",gap:"6px",zIndex:10}}>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value as any)} style={{...selStyle,height:"30px",fontSize:"10px",background:"rgba(255,236,209,0.95)",backdropFilter:"blur(8px)"}}>
                <option value="score">✦ Best</option>
                <option value="distance">📍 Near</option>
                <option value="price">₹ Price</option>
              </select>
              <select value={radius} onChange={e=>setRadius(Number(e.target.value))} style={{...selStyle,height:"30px",fontSize:"10px",background:"rgba(255,236,209,0.95)",backdropFilter:"blur(8px)"}}>
                <option value={1000}>1 km</option>
                <option value={2000}>2 km</option>
                <option value={4000}>4 km</option>
                <option value={6000}>6 km</option>
                <option value={10000}>10 km</option>
              </select>
            </div>
          </div>

          {/* Mobile bottom tab bar — Map | List */}
          <div style={{flexShrink:0,background:"rgba(255,236,209,0.97)",backdropFilter:"blur(12px)",borderTop:"1px solid rgba(192,133,82,0.2)",display:"flex",zIndex:20}}>
            {(["map","list"] as const).map(tab=>(
              <button key={tab} onClick={()=>setMobileSheet(tab)} style={{flex:1,padding:"12px 0",border:"none",background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:400,letterSpacing:"0.06em",color:mobileSheet===tab?T.chocolate:"rgba(137,87,55,0.5)",cursor:"pointer",transition:"all 0.2s",borderTop:`2px solid ${mobileSheet===tab?T.caramel:"transparent"}`,display:"flex",flexDirection:"column" as const,alignItems:"center",gap:"3px"}}>
                <span style={{fontSize:"16px"}}>{tab==="map"?"🗺️":"📋"}</span>
                <span>{tab==="map"?"Map":"Places"}</span>
              </button>
            ))}
            {groupMode&&(
              <button onClick={()=>setShowMobileGroup(true)} style={{flex:1,padding:"12px 0",border:"none",background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:400,letterSpacing:"0.06em",color:showMobileGroup?T.chocolate:"rgba(137,87,55,0.5)",cursor:"pointer",transition:"all 0.2s",borderTop:`2px solid ${showMobileGroup?T.caramel:"transparent"}`,display:"flex",flexDirection:"column" as const,alignItems:"center",gap:"3px",position:"relative" as const}}>
                <span style={{fontSize:"16px"}}>👥</span>
                <span>Group</span>
                {activeUserCount>1&&<span style={{position:"absolute",top:"8px",right:"calc(50% - 20px)",width:"14px",height:"14px",background:T.caramel,borderRadius:"50%",fontSize:"8px",display:"flex",alignItems:"center",justifyContent:"center",color:T.sand,fontWeight:500}}>{activeUserCount}</span>}
              </button>
            )}
          </div>

          {/* Mobile bottom sheet — List */}
          {mobileSheet==="list"&&(
            <div style={{position:"absolute",bottom:"52px",left:0,right:0,height:"65vh",background:T.cream,borderRadius:"20px 20px 0 0",boxShadow:"0 -6px 32px rgba(62,0,12,0.12)",border:"1px solid rgba(192,133,82,0.2)",borderBottom:"none",display:"flex",flexDirection:"column" as const,zIndex:15,animation:"sheetUp 0.3s cubic-bezier(0.22,1,0.36,1)"}}>
              {/* Sheet handle */}
              <div style={{flexShrink:0,display:"flex",justifyContent:"center",padding:"10px 0 6px"}}>
                <div style={{width:"36px",height:"3px",borderRadius:"2px",background:"rgba(192,133,82,0.3)"}}/>
              </div>
              {/* Tabs inside sheet */}
              <div style={{display:"flex",alignItems:"center",gap:"6px",padding:"0 14px 8px",flexShrink:0}}>
                <div style={{flex:1,background:"rgba(243,233,220,0.7)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"10px",padding:"3px",display:"flex",gap:"2px"}}>
                  {(["all","shortlist"] as const).map(tab=>(
                    <button key={tab} onClick={()=>setActiveTab(tab)} style={{flex:1,padding:"7px 0",border:"none",borderRadius:"8px",background:activeTab===tab?T.chocolate:"none",fontFamily:"'DM Sans',sans-serif",fontSize:"11px",fontWeight:400,letterSpacing:"0.04em",color:activeTab===tab?T.sand:"rgba(137,87,55,0.65)",cursor:"pointer",transition:"all 0.22s",whiteSpace:"nowrap" as const,boxShadow:activeTab===tab?"0 2px 8px rgba(62,0,12,0.18)":"none"}}>{tab==="all"?`✦ All${!loading?` (${displayedItems.length})`:""}`:`⭐ Saved (${shortlist.length})`}</button>
                  ))}
                </div>
              </div>
              {activeTab==="all"&&!groupMode&&(
                <div style={{padding:"0 14px 8px",flexShrink:0}}>
                  <input type="text" placeholder="🔍 Filter…" value={resultsQuery} onChange={e=>setResultsQuery(e.target.value)} style={{width:"100%",background:"rgba(255,255,255,0.45)",border:"1px solid rgba(192,133,82,0.2)",borderRadius:"9px",padding:"7px 12px",fontFamily:"'DM Sans',sans-serif",fontSize:"12px",fontWeight:300,color:T.chocolate,outline:"none"}} onFocus={e=>{e.currentTarget.style.borderColor=T.caramel;}} onBlur={e=>{e.currentTarget.style.borderColor="rgba(192,133,82,0.2)";}}/>
                </div>
              )}
              <div style={{flex:1,overflow:"hidden",padding:"0 14px 0"}}>
                {ResultsList}
              </div>
            </div>
          )}

          {/* Mobile Group sheet */}
          {groupMode&&showMobileGroup&&(
            <div style={{position:"absolute",bottom:"52px",left:0,right:0,height:"70vh",background:T.sand,borderRadius:"20px 20px 0 0",boxShadow:"0 -6px 32px rgba(62,0,12,0.12)",border:"1px solid rgba(192,133,82,0.2)",borderBottom:"none",display:"flex",flexDirection:"column" as const,zIndex:20,animation:"sheetUp 0.3s cubic-bezier(0.22,1,0.36,1)"}}>
              {/* Sheet handle + header */}
              <div style={{flexShrink:0,display:"flex",justifyContent:"center",padding:"10px 0 4px"}}>
                <div style={{width:"36px",height:"3px",borderRadius:"2px",background:"rgba(192,133,82,0.3)"}}/>
              </div>
              <div style={{background:T.chocolate,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,position:"relative" as const,overflow:"hidden"}}>
                <div style={{position:"absolute",inset:0,opacity:0.03,backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,pointerEvents:"none"}}/>
                <span style={{fontFamily:"'Cormorant Garamond',serif",fontWeight:300,fontStyle:"italic",fontSize:"16px",letterSpacing:"0.1em",color:T.sand,position:"relative"}}>Group Setup</span>
                <button onClick={()=>setShowMobileGroup(false)} style={{background:"none",border:"none",color:"rgba(255,236,209,0.5)",fontSize:"16px",cursor:"pointer",transition:"color 0.15s",lineHeight:"1",padding:"2px",position:"relative"}} onMouseEnter={e=>{e.currentTarget.style.color=T.sand;}} onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,236,209,0.5)";}}>✕</button>
              </div>
              <div style={{flex:1,overflow:"hidden"}}>
                {GroupPanelContent}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}