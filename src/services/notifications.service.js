import{query}from"../db.js";import{safeJson}from"../utils.js";
export const NotificationsService={
 async list(userId,p={}){const limit=Math.min(+p.limit||30,100);const r=await query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2",[userId,limit]);const unread=await query("SELECT count(*) FROM notifications WHERE user_id=$1 AND NOT is_read",[userId]);return{data:r.rows.map(safeJson),unread:+unread.rows[0].count}},
 async markRead(userId,id){return safeJson((await query("UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2 RETURNING *",[id,userId])).rows[0])},
 async markAllRead(userId){await query("UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND NOT is_read",[userId]);return{message:"All notifications marked read."}},
 async notifyAdmins(title,message,type="info",link=null,metadata={}){await query("INSERT INTO notifications(user_id,title,message,type,link,metadata) SELECT id,$1,$2,$3,$4,$5 FROM users WHERE is_admin AND is_active",[title,message,type,link,metadata])},
 async admins(){return(await query("SELECT email,name FROM users WHERE is_admin AND is_active AND email_verified")).rows}
};
