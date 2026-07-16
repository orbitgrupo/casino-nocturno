'use strict';

const { AccessToken } = require('livekit-server-sdk');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadLocalEnv(){
  const file=path.join(__dirname,'.env.livekit');
  if(!fs.existsSync(file))return;
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
  for(const line of lines){
    const clean=line.trim();
    if(!clean||clean.startsWith('#')||!clean.includes('='))continue;
    const index=clean.indexOf('=');
    const key=clean.slice(0,index).trim();
    const value=clean.slice(index+1).trim().replace(/^["']|["']$/g,'');
    if(key)process.env[key]=value;
  }
}
loadLocalEnv();

function required(name){
  const value=process.env[name];
  if(!value)throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function createVoiceTokenRouter(express){
  const router=express.Router();
  const supabase=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const livekitUrl=required('LIVEKIT_PUBLIC_URL');
  const livekitKey=required('LIVEKIT_API_KEY');
  const livekitSecret=required('LIVEKIT_API_SECRET');

  router.post('/livekit/token',async(req,res)=>{
    try{
      const auth=String(req.headers.authorization||'');
      const accessToken=auth.startsWith('Bearer ')?auth.slice(7):'';
      const roomId=String(req.body?.roomId||'').trim();
      if(!accessToken)return res.status(401).json({error:'AUTH_REQUIRED'});
      if(!/^[0-9a-f-]{36}$/i.test(roomId))return res.status(400).json({error:'INVALID_ROOM_ID'});

      const {data:userData,error:userError}=await supabase.auth.getUser(accessToken);
      if(userError||!userData?.user)return res.status(401).json({error:'INVALID_SESSION'});
      const userId=userData.user.id;

      const {data:member,error:memberError}=await supabase
        .from('casino_room_members')
        .select('user_id,display_name,member_role,seat,casino_rooms!inner(id,invite_code,game_type,status,is_locked)')
        .eq('room_id',roomId)
        .eq('user_id',userId)
        .maybeSingle();

      if(memberError)throw memberError;
      if(!member)return res.status(403).json({error:'NOT_ROOM_MEMBER'});

      const casinoRoom=member.casino_rooms;
      if(!casinoRoom||casinoRoom.status==='closed')return res.status(403).json({error:'ROOM_CLOSED'});
      if(casinoRoom.is_locked)return res.status(403).json({error:'ROOM_LOCKED'});

      const voiceRoom=`casino-${casinoRoom.game_type}-${casinoRoom.id}`;
      const canPublish=member.member_role!=='spectator';
      const identity=`${userId}:${roomId}`;
      const token=new AccessToken(livekitKey,livekitSecret,{
        identity,
        name:member.display_name||'Jugador',
        ttl:'1h',
        metadata:JSON.stringify({
          casinoRoomId:casinoRoom.id,
          inviteCode:casinoRoom.invite_code,
          gameType:casinoRoom.game_type,
          role:member.member_role,
          seat:member.seat
        })
      });
      token.addGrant({
        room:voiceRoom,
        roomJoin:true,
        canSubscribe:true,
        canPublish,
        canPublishData:canPublish
      });

      res.json({url:livekitUrl,token:await token.toJwt(),room:voiceRoom,canPublish});
    }catch(error){
      console.error('[livekit-token]',error);
      res.status(500).json({error:'VOICE_TOKEN_ERROR'});
    }
  });

  return router;
}

module.exports={createVoiceTokenRouter};
