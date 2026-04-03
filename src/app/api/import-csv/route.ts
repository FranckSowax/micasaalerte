import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CONTRIBUTORS_DATA = [
  { group_id: "1676064106349717", group_name: "ZOOM IMMOBILIER GABON", member_id: "100069015940592", member_name: "Easy Loc Services", member_url: "https://www.facebook.com/groups/1676064106349717/user/100069015940592" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100001426733875", member_name: "Carl-lestate Mbina Moundounga", member_url: "https://www.facebook.com/groups/833974576641569/user/100001426733875" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100063558637554", member_name: "Roland Immo", member_url: "https://www.facebook.com/groups/833974576641569/user/100063558637554" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "100034290224087", member_name: "Noe Immo", member_url: "https://www.facebook.com/groups/203424540054787/user/100034290224087" },
  { group_id: "753697345085102", group_name: "Maison a vendre Gabon", member_id: "100063792696197", member_name: "Lewis achat maison terrain et location", member_url: "https://www.facebook.com/groups/753697345085102/user/100063792696197" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "100084369507683", member_name: "Gaetan Kelly Ngombe", member_url: "https://www.facebook.com/groups/6020639628004596/user/100084369507683" },
  { group_id: "834936016677757", group_name: "L'IMMOBILIER D'OWENDO", member_id: "100022178539199", member_name: "Christ Standing", member_url: "https://www.facebook.com/groups/834936016677757/user/100022178539199" },
  { group_id: "1562720580862985", group_name: "BON COIN IMMOBILIER GABON", member_id: "100076212929485", member_name: "Awele Hair Cosmetiques", member_url: "https://www.facebook.com/groups/1562720580862985/user/100076212929485" },
  { group_id: "472212389862328", group_name: "MAISONS APPARTEMENTS a louer vendre Au GABON", member_id: "61572449247103", member_name: "tropicale immo", member_url: "https://www.facebook.com/groups/472212389862328/user/61572449247103" },
  { group_id: "114501945877561", group_name: "Promo immo Gabon", member_id: "100069621263102", member_name: "Promo Immo Gabon", member_url: "https://www.facebook.com/groups/114501945877561/user/100069621263102" },
  { group_id: "167101365342338", group_name: "Studios et maisons Nzeng Ayong", member_id: "100079144603617", member_name: "Jonathan Arnold Mwamba Kambo", member_url: "https://www.facebook.com/groups/167101365342338/user/100079144603617" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "61557547941168", member_name: "Corina Minko", member_url: "https://www.facebook.com/groups/953208923179218/user/61557547941168" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100095330580100", member_name: "Marcher gabonais 241", member_url: "https://www.facebook.com/groups/953208923179218/user/100095330580100" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100055429876324", member_name: "Jika Kambo II", member_url: "https://www.facebook.com/groups/953208923179218/user/100055429876324" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "61579790737100", member_name: "Trouve ta voiture 241", member_url: "https://www.facebook.com/groups/833974576641569/user/61579790737100" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100054396054736", member_name: "Joshua Houenassou", member_url: "https://www.facebook.com/groups/833974576641569/user/100054396054736" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "100067401866344", member_name: "Johan Solution", member_url: "https://www.facebook.com/groups/6020639628004596/user/100067401866344" },
  { group_id: "985585794841161", group_name: "FALL MAISON A LOUER", member_id: "100080927016347", member_name: "Akanni Koudous", member_url: "https://www.facebook.com/groups/985585794841161/user/100080927016347" },
  { group_id: "833974576641569", group_name: "Gabon Immobilier", member_id: "100003600200046", member_name: "Olivier Mbembo", member_url: "https://www.facebook.com/groups/833974576641569/user/100003600200046" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "100063945977480", member_name: "LaPub", member_url: "https://www.facebook.com/groups/203424540054787/user/100063945977480" },
  { group_id: "4635403043145434", group_name: "Societe Immobiliere du Gabon", member_id: "61581951695527", member_name: "Transformation du bois gabonais", member_url: "https://www.facebook.com/groups/4635403043145434/user/61581951695527" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", member_id: "61574667134572", member_name: "Kelly Immobilier", member_url: "https://www.facebook.com/groups/130930232001761/user/61574667134572" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "100041914239325", member_name: "Buster Alpha", member_url: "https://www.facebook.com/groups/203424540054787/user/100041914239325" },
  { group_id: "130930232001761", group_name: "Akanda Maisons Chambres Studios", member_id: "100008361454377", member_name: "Evangeliste Moun Saint Jean", member_url: "https://www.facebook.com/groups/130930232001761/user/100008361454377" },
  { group_id: "953208923179218", group_name: "Maison a louer 2 Akanda Lbv Owendo", member_id: "100028209741362", member_name: "Onesime Negoce", member_url: "https://www.facebook.com/groups/953208923179218/user/100028209741362" },
  { group_id: "203424540054787", group_name: "Immobilier Libreville et services", member_id: "61574773965091", member_name: "Horizonn", member_url: "https://www.facebook.com/groups/203424540054787/user/61574773965091" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "61550821838404", member_name: "Gabao Home", member_url: "https://www.facebook.com/groups/6020639628004596/user/61550821838404" },
  { group_id: "6020639628004596", group_name: "TOUT SUR IMMOBILIER AU GABON", member_id: "100004520567661", member_name: "Moussadji Montcho Florentin", member_url: "https://www.facebook.com/groups/6020639628004596/user/100004520567661" },
  { group_id: "869424666965185", group_name: "Maison a Louer 100% LIBREVILLE/GABON", member_id: "100026306227108", member_name: "Typhani Mba Mintsa", member_url: "https://www.facebook.com/groups/869424666965185/user/100026306227108" },
];

const AGENTS_DATA = [
  { profile_id: "freezdarlain.engone", profile_url: "https://www.facebook.com/freezdarlain.engone", profile_name: "Freezdarlain Engone" },
  { profile_id: "cedryc.engoneobiang", profile_url: "https://www.facebook.com/cedryc.engoneobiang", profile_name: "Cedryc Engone Obiang" },
  { profile_id: "hamid.styve.mouandza", profile_url: "https://www.facebook.com/hamid.styve.mouandza", profile_name: "Hamid Styve Mouandza" },
  { profile_id: "darwine.ebongue", profile_url: "https://www.facebook.com/darwine.ebongue", profile_name: "Darwine Ebongue" },
  { profile_id: "sparta.cus.71271", profile_url: "https://www.facebook.com/sparta.cus.71271", profile_name: "Spar Tacus" },
  { profile_id: "mac.donald.boussougou.boussougou", profile_url: "https://www.facebook.com/mac.donald.boussougou.boussougou", profile_name: "Mac Donald Boussougou" },
  { profile_id: "marcellin.nzoma.5", profile_url: "https://www.facebook.com/marcellin.nzoma.5", profile_name: "Marcellin NZOMA" },
  { profile_id: "ri.chi", profile_url: "https://www.facebook.com/ri.chi", profile_name: "Ri Chi" },
  { profile_id: "warren.akigueovono", profile_url: "https://www.facebook.com/warren.akigueovono", profile_name: "Warren Akigueovono" },
  { profile_id: "pepe.aliasobiang", profile_url: "https://www.facebook.com/pepe.aliasobiang", profile_name: "Pepe Obiang" },
  { profile_id: "jasmine.carine", profile_url: "https://www.facebook.com/jasmine.carine", profile_name: "Jasmine Carine" },
  { profile_id: "kennyova.messa", profile_url: "https://www.facebook.com/kennyova.messa", profile_name: "Kenny Ova Messa" },
  { profile_id: "niyto.sidibe", profile_url: "https://www.facebook.com/niyto.sidibe", profile_name: "Niyto Sidibe" },
  { profile_id: "cherif.abdoul.halim", profile_url: "https://www.facebook.com/cherif.abdoul.halim", profile_name: "Cherif Abdoul-Halim" },
  { profile_id: "junior.ndong.obame", profile_url: "https://www.facebook.com/junior.ndong.obame", profile_name: "Junior Ndong Obame" },
  { profile_id: "joseph.wolb", profile_url: "https://www.facebook.com/joseph.wolb", profile_name: "Joseph Wolb" },
  { profile_id: "princesse.ondo", profile_url: "https://www.facebook.com/princesse.ondo", profile_name: "Princesse Ondo" },
  { profile_id: "yene.junior.be.mengue", profile_url: "https://www.facebook.com/yene.junior.be.mengue", profile_name: "Yene Junior Be Mengue" },
  { profile_id: "youri.ekoghamengue", profile_url: "https://www.facebook.com/youri.ekoghamengue", profile_name: "Youri Ekogha Mengue" },
  { profile_id: "gillesfranck.ndongho.9", profile_url: "https://www.facebook.com/gillesfranck.ndongho.9", profile_name: "Franck Immo" },
  { profile_id: "esthere.ellambal", profile_url: "https://www.facebook.com/esthere.ellambal", profile_name: "Esthere Ella Mba" },
  { profile_id: "dieudonne.obame.94", profile_url: "https://www.facebook.com/dieudonne.obame.94", profile_name: "Dieudonne Obame" },
  { profile_id: "franck.chatillon.37", profile_url: "https://www.facebook.com/franck.chatillon.37", profile_name: "Apoutine Multi-Services" },
  { profile_id: "litadi.ayidi", profile_url: "https://www.facebook.com/litadi.ayidi", profile_name: "Tsinga Ingrid Maya" },
  { profile_id: "christian.vignac", profile_url: "https://www.facebook.com/christian.vignac", profile_name: "Christian Vignac" },
];

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const serviceClient = createServiceClient();
  const results = { contributors: { inserted: 0, skipped: 0, errors: [] as string[] }, agents: { inserted: 0, skipped: 0, errors: [] as string[] } };

  // Import contributors
  for (const c of CONTRIBUTORS_DATA) {
    const { error } = await serviceClient.from("contributors").upsert({
      user_id: user.id,
      ...c,
    }, { onConflict: "user_id,group_id,member_id" });

    if (error) {
      if (error.message.includes("duplicate") || error.message.includes("already exists")) {
        results.contributors.skipped++;
      } else {
        results.contributors.errors.push(`${c.member_name}: ${error.message}`);
      }
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
      if (error.message.includes("duplicate") || error.message.includes("already exists")) {
        results.agents.skipped++;
      } else {
        results.agents.errors.push(`${a.profile_name}: ${error.message}`);
      }
    } else {
      results.agents.inserted++;
    }
  }

  return NextResponse.json({
    success: true,
    contributors: `${results.contributors.inserted} ajoutés, ${results.contributors.skipped} doublons`,
    agents: `${results.agents.inserted} ajoutés, ${results.agents.skipped} doublons`,
    errors: [...results.contributors.errors, ...results.agents.errors],
  });
}
