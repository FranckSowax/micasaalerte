import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CONTRIBUTORS_DATA = [
  { group_id: "1676064106349717", group_name: "ZOOM IMMOBILIER GABON", member_id: "100069015940592", member_name: "Easy Loc Services", member_url: "https://www.facebook.com/groups/1676064106349717/user/100069015940592" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100001426733875", member_name: "Carl-lestate Mbina Moundounga", member_url: "https://www.facebook.com/groups/833974576641569/user/100001426733875" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100063558637554", member_name: "Roland Immo", member_url: "https://www.facebook.com/groups/833974576641569/user/100063558637554" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "100034290224087", member_name: "Noe Immo", member_url: "https://www.facebook.com/groups/203424540054787/user/100034290224087" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "100067401866344", member_name: "Johan solution", member_url: "https://www.facebook.com/groups/6020639628004596/user/100067401866344" },
  { group_id: "985585794841161", group_name: "FALL MAISON A LOUER", member_id: "61556456428703", member_name: "Arafat Chris Arafat", member_url: "https://www.facebook.com/groups/985585794841161/user/61556456428703" },
  { group_id: "114501945877561", group_name: "Promo immo Gabon", member_id: "100063792696197", member_name: "Lewis achat maison terrain et location", member_url: "https://www.facebook.com/groups/114501945877561/user/100063792696197" },
  { group_id: "167101365342338", group_name: "Studios et maisons Nzeng Ayong", member_id: "100006012740979", member_name: "Sarah Mendez", member_url: "https://www.facebook.com/groups/167101365342338/user/100006012740979" },
  { group_id: "167101365342338", group_name: "Studios et maisons Nzeng Ayong", member_id: "100022178539199", member_name: "Christ Standing", member_url: "https://www.facebook.com/groups/167101365342338/user/100022178539199" },
  { group_id: "869424666965185", group_name: "Maison a Louer 100% LIBREVILLE/GABON", member_id: "100076212929485", member_name: "Awele Hair Cosmetiques", member_url: "https://www.facebook.com/groups/869424666965185/user/100076212929485" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", member_id: "61572449247103", member_name: "tropicale immo", member_url: "https://www.facebook.com/groups/130930232001761/user/61572449247103" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100095330580100", member_name: "Marcher gabonais 241", member_url: "https://www.facebook.com/groups/953208923179218/user/100095330580100" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100055429876324", member_name: "Jika Kambo II", member_url: "https://www.facebook.com/groups/953208923179218/user/100055429876324" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "61579790737100", member_name: "Trouve ta voiture 241", member_url: "https://www.facebook.com/groups/833974576641569/user/61579790737100" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100054396054736", member_name: "Joshua Houenassou", member_url: "https://www.facebook.com/groups/833974576641569/user/100054396054736" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "100084369507683", member_name: "Gaetan Kelly Ngombe", member_url: "https://www.facebook.com/groups/6020639628004596/user/100084369507683" },
  { group_id: "1438101219987499", group_name: "ZOOM LIBREVILLE GABON", member_id: "61579401242987", member_name: "A.M clean", member_url: "https://www.facebook.com/groups/1438101219987499/user/61579401242987" },
  { group_id: "985585794841161", group_name: "FALL MAISON A LOUER", member_id: "100080927016347", member_name: "Akanni Koudous", member_url: "https://www.facebook.com/groups/985585794841161/user/100080927016347" },
  { group_id: "167101365342338", group_name: "Studios et maisons Nzeng Ayong", member_id: "100079144603617", member_name: "Jonathan Arnold Mwamba Kambo", member_url: "https://www.facebook.com/groups/167101365342338/user/100079144603617" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "61557547941168", member_name: "Corina Minko", member_url: "https://www.facebook.com/groups/953208923179218/user/61557547941168" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100003600200046", member_name: "Olivier Mbembo", member_url: "https://www.facebook.com/groups/833974576641569/user/100003600200046" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "100063945977480", member_name: "LaPub", member_url: "https://www.facebook.com/groups/203424540054787/user/100063945977480" },
  { group_id: "114501945877561", group_name: "Promo immo Gabon", member_id: "61552491623239", member_name: "Niyto Sidibe", member_url: "https://www.facebook.com/groups/114501945877561/user/61552491623239" },
  { group_id: "869424666965185", group_name: "Maison a Louer 100% LIBREVILLE/GABON", member_id: "61550809991525", member_name: "Sale of Gabon", member_url: "https://www.facebook.com/groups/869424666965185/user/61550809991525" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", member_id: "61571466668270", member_name: "Enigma", member_url: "https://www.facebook.com/groups/130930232001761/user/61571466668270" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", member_id: "61574667134572", member_name: "Demshouse", member_url: "https://www.facebook.com/groups/130930232001761/user/61574667134572" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "100041914239325", member_name: "Buster Alpha", member_url: "https://www.facebook.com/groups/203424540054787/user/100041914239325" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", member_id: "100008361454377", member_name: "Evangeliste Moun Saint Jean", member_url: "https://www.facebook.com/groups/130930232001761/user/100008361454377" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100083274527279", member_name: "Curtis Mba", member_url: "https://www.facebook.com/groups/953208923179218/user/100083274527279" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100028209741362", member_name: "Onesime Negoce", member_url: "https://www.facebook.com/groups/953208923179218/user/100028209741362" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "61574773965091", member_name: "Horizonn", member_url: "https://www.facebook.com/groups/203424540054787/user/61574773965091" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "61550821838404", member_name: "Gabao Home", member_url: "https://www.facebook.com/groups/6020639628004596/user/61550821838404" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "100004520567661", member_name: "Moussadji Montcho Florentin", member_url: "https://www.facebook.com/groups/6020639628004596/user/100004520567661" },
  { group_id: "869424666965185", group_name: "Maison a Louer 100% LIBREVILLE/GABON", member_id: "100026306227108", member_name: "Typhani Mba Mintsa", member_url: "https://www.facebook.com/groups/869424666965185/user/100026306227108" },
  { group_id: "653314586943694", group_name: "Studio et chambre a louer Libreville fiable", member_id: "100064090316866", member_name: "Jean Nzong", member_url: "https://www.facebook.com/groups/653314586943694/user/100064090316866" },
  { group_id: "1668716060183614", group_name: "Villa et appartement meuble Libreville", member_id: "61573476625988", member_name: "Akanda Dance Crew", member_url: "https://www.facebook.com/groups/1668716060183614/user/61573476625988" },
  { group_id: "1668716060183614", group_name: "Villa et appartement meuble Libreville", member_id: "61568927032771", member_name: "Gabon immo 2", member_url: "https://www.facebook.com/groups/1668716060183614/user/61568927032771" },
  { group_id: "1668716060183614", group_name: "Villa et appartement meuble Libreville", member_id: "61574580488862", member_name: "Services immobiliers du Gabon", member_url: "https://www.facebook.com/groups/1668716060183614/user/61574580488862" },
  { group_id: "984035471633013", group_name: "A louer derriere la pediatrie Owendo", member_id: "100075476147725", member_name: "Kamdjom Ismael", member_url: "https://www.facebook.com/groups/984035471633013/user/100075476147725" },
];

const AGENTS_DATA = [
  { profile_id: "freezdarlain.engone", profile_url: "https://www.facebook.com/freezdarlain.engone", profile_name: "Freezdarlain Engone" },
  { profile_id: "cedryc.engoneobiang", profile_url: "https://www.facebook.com/cedryc.engoneobiang", profile_name: "Cedryc Engone Obiang" },
  { profile_id: "hamid.styve.mouandza", profile_url: "https://www.facebook.com/hamid.styve.mouandza", profile_name: "Hamid Styve Mouandza" },
  { profile_id: "darwine.ebongue", profile_url: "https://www.facebook.com/darwine.ebongue", profile_name: "Darwine Ebongue" },
  { profile_id: "christian.vignac", profile_url: "https://www.facebook.com/christian.vignac", profile_name: "Christian Vignac" },
  { profile_id: "ri.chi", profile_url: "https://www.facebook.com/ri.chi", profile_name: "Ri Chi" },
  { profile_id: "jasmine.carine", profile_url: "https://www.facebook.com/jasmine.carine", profile_name: "Jasmine Carine" },
  { profile_id: "joseph.wolb", profile_url: "https://www.facebook.com/joseph.wolb", profile_name: "Joseph Wolb" },
  { profile_id: "delphineestelle.nzongelemva", profile_url: "https://www.facebook.com/delphineestelle.nzongelemva", profile_name: "Delphine-estelle Nzong-elemva" },
  { profile_id: "warren.akigueovono", profile_url: "https://www.facebook.com/warren.akigueovono", profile_name: "Warren Akigueovono" },
  { profile_id: "pepe.aliasobiang", profile_url: "https://www.facebook.com/pepe.aliasobiang", profile_name: "Pepe Obiang" },
  { profile_id: "mac.donald.boussougou.boussougou", profile_url: "https://www.facebook.com/mac.donald.boussougou.boussougou", profile_name: "Mac Donald Boussougou" },
  { profile_id: "kennyova.messa", profile_url: "https://www.facebook.com/kennyova.messa", profile_name: "Kenny Ova Messa" },
  { profile_id: "yene.junior.be.mengue", profile_url: "https://www.facebook.com/yene.junior.be.mengue", profile_name: "Yene Junior Be Mengue" },
  { profile_id: "youri.ekoghamengue", profile_url: "https://www.facebook.com/youri.ekoghamengue", profile_name: "Youri Ekogha Mengue" },
  { profile_id: "gillesfranck.ndongho.9", profile_url: "https://www.facebook.com/gillesfranck.ndongho.9", profile_name: "Franck Immo" },
  { profile_id: "dieudonne.obame.94", profile_url: "https://www.facebook.com/dieudonne.obame.94", profile_name: "Dieudonne Obame" },
  { profile_id: "franck.chatillon.37", profile_url: "https://www.facebook.com/franck.chatillon.37", profile_name: "Apoutine Multi-Services" },
  { profile_id: "litadi.ayidi", profile_url: "https://www.facebook.com/litadi.ayidi", profile_name: "Tsinga Ingrid Maya" },
  { profile_id: "kevin.gayitou", profile_url: "https://www.facebook.com/kevin.gayitou", profile_name: "Kevin Gayitou" },
  { profile_id: "alex.nguemaobame.3", profile_url: "https://www.facebook.com/alex.nguemaobame.3", profile_name: "Alex Nguema Obame" },
  { profile_id: "lizzi.nnal.9", profile_url: "https://www.facebook.com/lizzi.nnal.9", profile_name: "Lizzi Nnal" },
  { profile_id: "alino.bamos.9", profile_url: "https://www.facebook.com/alino.bamos.9", profile_name: "Gauthier Immo" },
  { profile_id: "sparta.cus.71271", profile_url: "https://www.facebook.com/sparta.cus.71271", profile_name: "Spar Tacus" },
];

const GROUPS_DATA = [
  { group_id: "1676064106349717", group_name: "ZOOM IMMOBILIER GABON", group_url: "https://facebook.com/groups/1676064106349717" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", group_url: "https://facebook.com/groups/833974576641569" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", group_url: "https://facebook.com/groups/203424540054787" },
  { group_id: "753697345085102", group_name: "Maison a vendre Gabon", group_url: "https://facebook.com/groups/753697345085102" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", group_url: "https://facebook.com/groups/6020639628004596" },
  { group_id: "4635403043145434", group_name: "Societe Immobiliere du Gabon", group_url: "https://facebook.com/groups/4635403043145434" },
  { group_id: "1438101219987499", group_name: "ZOOM LIBREVILLE GABON", group_url: "https://facebook.com/groups/1438101219987499" },
  { group_id: "834936016677757", group_name: "IMMOBILIER OWENDO", group_url: "https://facebook.com/groups/834936016677757" },
  { group_id: "985585794841161", group_name: "FALL MAISON A LOUER", group_url: "https://facebook.com/groups/985585794841161" },
  { group_id: "114501945877561", group_name: "Promo immo Gabon", group_url: "https://facebook.com/groups/114501945877561" },
  { group_id: "167101365342338", group_name: "Studios et maisons Nzeng Ayong", group_url: "https://facebook.com/groups/167101365342338" },
  { group_id: "869424666965185", group_name: "Maison a Louer 100% LIBREVILLE/GABON", group_url: "https://facebook.com/groups/869424666965185" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", group_url: "https://facebook.com/groups/130930232001761" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", group_url: "https://facebook.com/groups/953208923179218" },
  { group_id: "653314586943694", group_name: "Studio et chambre a louer Libreville fiable", group_url: "https://facebook.com/groups/653314586943694" },
  { group_id: "1668716060183614", group_name: "Villa et appartement meuble Libreville", group_url: "https://facebook.com/groups/1668716060183614" },
  { group_id: "613635432543380", group_name: "Chambre a louer moins chers Libreville", group_url: "https://facebook.com/groups/613635432543380" },
  { group_id: "1088682014612530", group_name: "MAISONS ET BARS A LOUER LIBREVILLE", group_url: "https://facebook.com/groups/1088682014612530" },
  { group_id: "652190740417788", group_name: "MAISON ET STUDIO A LOUER A OWENDO", group_url: "https://facebook.com/groups/652190740417788" },
  { group_id: "175015613044571", group_name: "Maison Studio Chambre a louer Owendo", group_url: "https://facebook.com/groups/175015613044571" },
  { group_id: "928564618145070", group_name: "MAISON a louer uniquement dans OWENDO", group_url: "https://facebook.com/groups/928564618145070" },
  { group_id: "984035471633013", group_name: "A louer derriere la pediatrie Owendo", group_url: "https://facebook.com/groups/984035471633013" },
];

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();
  const results = {
    groups: { inserted: 0, skipped: 0, errors: [] as string[] },
    contributors: { inserted: 0, skipped: 0, errors: [] as string[] },
    agents: { inserted: 0, skipped: 0, errors: [] as string[] },
  };

  // Import groups
  for (const g of GROUPS_DATA) {
    const { error } = await serviceClient.from("facebook_groups").upsert({
      user_id: user.id,
      ...g,
    }, { onConflict: "user_id,group_id" });
    if (error) {
      if (error.message.includes("duplicate")) results.groups.skipped++;
      else results.groups.errors.push(`${g.group_name}: ${error.message}`);
    } else {
      results.groups.inserted++;
    }
  }

  // Import contributors
  for (const c of CONTRIBUTORS_DATA) {
    const { error } = await serviceClient.from("contributors").upsert({
      user_id: user.id,
      ...c,
    }, { onConflict: "user_id,group_id,member_id" });
    if (error) {
      if (error.message.includes("duplicate")) results.contributors.skipped++;
      else results.contributors.errors.push(`${c.member_name}: ${error.message}`);
    } else {
      results.contributors.inserted++;
    }
  }

  // Import agents
  for (const a of AGENTS_DATA) {
    const { error } = await serviceClient.from("agent_profiles").upsert({
      user_id: user.id,
      ...a,
    }, { onConflict: "user_id,profile_id" });
    if (error) {
      if (error.message.includes("duplicate")) results.agents.skipped++;
      else results.agents.errors.push(`${a.profile_name}: ${error.message}`);
    } else {
      results.agents.inserted++;
    }
  }

  return NextResponse.json({
    success: true,
    groups: `${results.groups.inserted} ajoutés, ${results.groups.skipped} existants`,
    contributors: `${results.contributors.inserted} ajoutés, ${results.contributors.skipped} existants`,
    agents: `${results.agents.inserted} ajoutés, ${results.agents.skipped} existants`,
    errors: [...results.groups.errors, ...results.contributors.errors, ...results.agents.errors],
  });
}
