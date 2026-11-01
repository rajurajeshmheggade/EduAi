"""Built-in HQ (Human Quotient) item bank: age-banded situational-judgement (SJT), reflective and ideas items.

Read-only content covering EQ, SQ, AQ (SJT + reflective) and CQ (ideas) for four age bands. SJT scoring key:
Best = 2, Acceptable = 1, Poor = 0. Results are developmental and indicative only, never clinical or diagnostic.
Items are written to be culturally inclusive and free of gender, religion, caste, income or region stereotypes.
"""
from __future__ import annotations

AGE_BANDS = ["6-8", "9-11", "12-14", "15-17"]
DIMENSIONS = ["EQ", "SQ", "AQ", "CQ"]

QTYPES = {"SJT", "REFLECTIVE", "IDEAS"}

ITEMS: list[dict] = [
    # ------------------------------------------------------------------ 6-8
    {"item_id": "hq-6-8-sjt-01", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "You built a tall block tower. A classmate knocks it down by mistake. You feel very upset. "
               "What would you do?",
     "options": ["Shout at your classmate and push the blocks away.",
                 "Say 'I feel upset', take a breath, then rebuild.",
                 "Walk away quietly and play something else.",
                 "Knock down your classmate's tower to make it fair."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-6-8-sjt-02", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "At lunch break, your friend sits alone and looks sad. The tiffin box is still closed. "
               "What would you do?",
     "options": ["Keep playing, because it is not your problem.",
                 "Tell your friend to stop being sad and eat.",
                 "Tell the teacher that your friend looks sad.",
                 "Sit next to your friend and ask, 'Are you okay?'"],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-6-8-sjt-03", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "You lose a running race on sports day. Your eyes fill with tears. Everyone is clapping "
               "for the winner. What would you do?",
     "options": ["Say 'I feel sad', breathe slowly, then clap too.",
                 "Hide behind the school building until the day ends.",
                 "Say the winner cheated so you look better.",
                 "Stand quietly with your class and wait."],
     "answer_key": {"points": [2, 0, 0, 1]}},
    {"item_id": "hq-6-8-sjt-04", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "It is your turn to sing in the class assembly. You feel scared and your hands are shaking. "
               "What would you do?",
     "options": ["Pretend to be ill so you can go home.",
                 "Go on stage and hope it ends quickly.",
                 "Tell your teacher you feel nervous, then breathe deeply.",
                 "Cry and refuse to come out of the classroom."],
     "answer_key": {"points": [0, 1, 2, 0]}},
    {"item_id": "hq-6-8-sjt-05", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You are playing a game in the playground. A new child stands nearby, watching. Your friends "
               "say, 'We have enough players.' What would you do?",
     "options": ["Agree with your friends and keep playing.",
                 "Smile at the new child but keep playing.",
                 "Ask your friends to make space and invite the child.",
                 "Tell the new child to go and play elsewhere."],
     "answer_key": {"points": [0, 1, 2, 0]}},
    {"item_id": "hq-6-8-sjt-06", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You and a classmate both want the same red crayon for your drawings. There is only one. "
               "What would you do?",
     "options": ["Agree to take turns and use it one by one.",
                 "Grab the crayon quickly before your classmate does.",
                 "Use a different colour and say nothing.",
                 "Cry until the teacher gives it to you."],
     "answer_key": {"points": [2, 0, 1, 0]}},
    {"item_id": "hq-6-8-sjt-07", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You are the line leader today. Two classmates push to stand first in the line for the "
               "school bus. What would you do?",
     "options": ["Push them back so they learn a lesson.",
                 "Let them do whatever they want to do.",
                 "Call the teacher to sort it out.",
                 "Calmly ask them to wait for their turn."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-6-8-sjt-08", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "Your group is making one big poster. One child in your group has not drawn anything yet "
               "and looks left out. What would you do?",
     "options": ["Keep drawing fast so the poster gets finished.",
                 "Say, 'Your turn now!' and hand over the crayons.",
                 "Tell the teacher that one child is not working.",
                 "Leave a small corner of the poster for them."],
     "answer_key": {"points": [0, 2, 0, 1]}},
    {"item_id": "hq-6-8-sjt-09", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You try to tie your shoelaces, but the knot keeps coming loose. Your friends are waiting "
               "to go out. What would you do?",
     "options": ["Throw your shoes and say you will not go.",
                 "Blame the laces and say they are broken.",
                 "Ask a friend to tie them for you today.",
                 "Try again slowly and ask someone to show you."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-6-8-sjt-10", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You got many sums wrong in your maths homework. Your teacher has marked them in red. "
               "What would you do?",
     "options": ["Hide the notebook so no one at home sees.",
                 "Ask the teacher to explain, then redo the sums.",
                 "Try the same sums again by yourself.",
                 "Say the sums were too hard for anyone."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-6-8-sjt-11", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You practised for the spelling test, but you still got three words wrong. "
               "What would you do?",
     "options": ["Decide that you are just bad at spelling.",
                 "Tear up the test paper so nobody sees.",
                 "Find the words you missed and practise them again.",
                 "Feel sad, then forget about it and move on."],
     "answer_key": {"points": [0, 0, 2, 1]}},
    {"item_id": "hq-6-8-sjt-12", "age_band": "6-8", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "In a cricket game, you are out on the very first ball. Your team looks disappointed. "
               "What would you do?",
     "options": ["Say 'My mistake', then ask a friend for batting tips.",
                 "Say the bowler threw the ball unfairly.",
                 "Quit the game and go and sit alone.",
                 "Sit down quietly and cheer for your team."],
     "answer_key": {"points": [2, 0, 0, 1]}},
    {"item_id": "hq-6-8-ref-01", "age_band": "6-8", "qtype": "REFLECTIVE", "hq_dimension": "AQ",
     "prompt": "Tell us about a time something was hard for you, like learning to do something new. "
               "What did you do? Write a few sentences.",
     "options": [], "answer_key": None},
    {"item_id": "hq-6-8-ref-02", "age_band": "6-8", "qtype": "REFLECTIVE", "hq_dimension": "EQ",
     "prompt": "Think of a time you felt very happy, sad or angry. What made you feel that way, and what "
               "did you do? Write a few sentences.",
     "options": [], "answer_key": None},
    {"item_id": "hq-6-8-ref-03", "age_band": "6-8", "qtype": "REFLECTIVE", "hq_dimension": "SQ",
     "prompt": "Tell us about a time you helped a friend or shared something with someone. What happened? "
               "Write a few sentences.",
     "options": [], "answer_key": None},
    {"item_id": "hq-6-8-ideas-01", "age_band": "6-8", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "How many different ways can you use an empty plastic bottle? Write as many ideas as you "
               "can. You have 3 minutes.",
     "options": [], "answer_key": None},
    {"item_id": "hq-6-8-ideas-02", "age_band": "6-8", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "A piece of chalk is not only for writing on the board. What else could you do with it? "
               "List as many ideas as you can. You have 3 minutes.",
     "options": [], "answer_key": None},

    # ------------------------------------------------------------------ 9-11
    {"item_id": "hq-9-11-sjt-01", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "Your best friend has started sitting with a new group at lunch break. You feel left out "
               "and a little jealous. What would you do?",
     "options": ["Tell other classmates that the new group is mean and boring.",
                 "Stop talking to your friend so they feel what you feel.",
                 "Tell your friend you feel left out, and ask to join sometimes.",
                 "Sit with someone else and try not to think about it."],
     "answer_key": {"points": [0, 0, 2, 1]}},
    {"item_id": "hq-9-11-sjt-02", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "During a class quiz, you give a wrong answer and some classmates laugh. Your face feels hot "
               "and you want to shout at them. What would you do?",
     "options": ["Notice you feel embarrassed, take a slow breath, and keep going.",
                 "Ignore them and keep your eyes on the teacher until it passes.",
                 "Shout at them to stop laughing and call them names.",
                 "Refuse to answer any more questions for the rest of the day."],
     "answer_key": {"points": [2, 1, 0, 0]}},
    {"item_id": "hq-9-11-sjt-03", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "Your classmate's grandmother is unwell, and he has been very quiet all week. Today he "
               "snapped at you for no clear reason. What would you do?",
     "options": ["Snap back at him so he knows it is not okay.",
                 "Tell everyone in class that he is being rude to you.",
                 "Give him some space and stay away from him for now.",
                 "Stay calm, and later ask him gently how he is feeling."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-9-11-sjt-04", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "You worked hard on a model for the science fair, but it did not win a prize. Your friend's "
               "model won. What would you do?",
     "options": ["Say that your friend's model was copied from the internet.",
                 "Admit you feel disappointed, then congratulate your friend honestly.",
                 "Smile and say well done, but keep your feelings to yourself.",
                 "Stay away from your friend for the next few days."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-9-11-sjt-05", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "Your group is choosing a topic for a project. Two members keep arguing, and one quiet "
               "member has not spoken at all. What would you do?",
     "options": ["Pick your own favourite topic and tell everyone to accept it.",
                 "Ask everyone, even the quiet member, for an idea, then vote.",
                 "Suggest the group takes a vote between the two ideas.",
                 "Stay out of it and wait for the teacher to decide."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-9-11-sjt-06", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You are class monitor and must note the names of anyone making noise while the teacher is "
               "out. Your close friend is talking loudly. What would you do?",
     "options": ["Leave your friend's name out but write down everyone else's.",
                 "Ignore the noise completely so that nobody gets into trouble.",
                 "Write your friend's name down without saying anything first.",
                 "Remind your friend quietly first, and treat them like everyone else."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-9-11-sjt-07", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "In a football game at break, your team's best player keeps the ball and never passes. "
               "Some teammates are getting upset. What would you do?",
     "options": ["Kindly ask the player to pass more so everyone gets a chance.",
                 "Shout at the player in front of everyone to pass the ball.",
                 "Pass the ball around more yourself to show how teamwork looks.",
                 "Leave the game and tell the others to stop playing too."],
     "answer_key": {"points": [2, 0, 1, 0]}},
    {"item_id": "hq-9-11-sjt-08", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "A new classmate reads aloud slowly in English class. A few children giggle and copy her. "
               "She looks down at her book. What would you do?",
     "options": ["Giggle along so the others do not laugh at you.",
                 "Feel sorry for her but say nothing to anyone.",
                 "Ask the others to stop, and sit with her at break.",
                 "Tell the teacher privately that some children are teasing her."],
     "answer_key": {"points": [0, 0, 2, 1]}},
    {"item_id": "hq-9-11-sjt-09", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You were not selected for the school kabaddi team, but your friend was. The coach says "
               "there will be trials again next term. What would you do?",
     "options": ["Ask the coach what to improve, and practise those skills before next term.",
                 "Practise a bit more on your own and hope for better luck.",
                 "Tell everyone the coach only picks favourites, so trials are pointless.",
                 "Give up kabaddi and decide that sports are not for you."],
     "answer_key": {"points": [2, 1, 0, 0]}},
    {"item_id": "hq-9-11-sjt-10", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You forgot to bring your project file on the day it was due. The teacher asks you where "
               "it is. What would you do?",
     "options": ["Say that someone at home threw it away by mistake.",
                 "Say nothing and hope the teacher forgets about it.",
                 "Admit you forgot, ask to bring it tomorrow, and set a reminder.",
                 "Admit you forgot and accept whatever marks you get."],
     "answer_key": {"points": [0, 0, 2, 1]}},
    {"item_id": "hq-9-11-sjt-11", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You are stuck on a hard maths word problem in your homework. You have tried it twice and "
               "still cannot get the answer. What would you do?",
     "options": ["Copy the answer from a friend's notebook tomorrow morning.",
                 "Try a new method, like drawing it, then ask for help if stuck.",
                 "Read the question once more and try the same way again.",
                 "Decide you are just not good at maths and stop."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-9-11-sjt-12", "age_band": "9-11", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "In the inter-house quiz, your team loses because you pressed the buzzer too early and "
               "gave a wrong answer. Your teammates are disappointed. What would you do?",
     "options": ["Say the question was unfair and the quizmaster was confusing.",
                 "Avoid your teammates for the rest of the school day.",
                 "Say sorry to your team and try to forget about it.",
                 "Say sorry, and suggest the team practises buzzer rounds together."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-9-11-ref-01", "age_band": "9-11", "qtype": "REFLECTIVE", "hq_dimension": "AQ",
     "prompt": "Tell us about a time something did not go to plan, at school or at home. What did you do "
               "next, and what did you learn? Write a few sentences.",
     "options": [], "answer_key": None},
    {"item_id": "hq-9-11-ref-02", "age_band": "9-11", "qtype": "REFLECTIVE", "hq_dimension": "EQ",
     "prompt": "Describe a time you felt upset or worried. How did you calm yourself down, and who or what "
               "helped you? Write a few sentences.",
     "options": [], "answer_key": None},
    {"item_id": "hq-9-11-ref-03", "age_band": "9-11", "qtype": "REFLECTIVE", "hq_dimension": "SQ",
     "prompt": "Tell us about a time you worked in a team or group. What did you do to help everyone get "
               "along and feel included? Write a few sentences.",
     "options": [], "answer_key": None},
    {"item_id": "hq-9-11-ideas-01", "age_band": "9-11", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "List as many different uses of an old newspaper as you can. Try to think of unusual ideas "
               "too. You have 3 minutes.",
     "options": [], "answer_key": None},
    {"item_id": "hq-9-11-ideas-02", "age_band": "9-11", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "List as many different uses of a steel tumbler as you can, other than drinking from it. "
               "You have 3 minutes.",
     "options": [], "answer_key": None},

    # ------------------------------------------------------------------ 12-14
    {"item_id": "hq-12-14-sjt-01", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "Someone posts a photo of you in your class group chat with a funny caption. Several people "
               "react with laughing emojis. You feel embarrassed and angry. What is the best thing to do?",
     "options": ["Post an embarrassing photo of the person who posted yours, so they know how it feels.",
                 "Leave the group chat immediately and stop talking to anyone in the class for a while.",
                 "Ignore it completely and act as if nothing happened, even though it still bothers you.",
                 "Calm down first, then privately tell the person it upset you and ask them to remove it."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-12-14-sjt-02", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "You scored lower than expected in a unit test. At a family gathering, a relative compares "
               "you with a cousin who scored higher. You feel hurt and frustrated. What would you do?",
     "options": ["Argue loudly that comparisons are unfair and that you do not care about marks.",
                 "Calmly say that the comparison hurts, and share your own plan to improve.",
                 "Nod politely and keep your feelings to yourself so the conversation ends quickly.",
                 "Stop talking to your cousin, because they always make you look bad."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-12-14-sjt-03", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "Your friend was not chosen for the school band, which they really wanted. You were chosen. "
               "They say, 'It's fine,' but they look upset. What is the best thing to do?",
     "options": ["Say it must feel disappointing, and ask if they want to talk or practise together.",
                 "Tell them all about the first band practice, hoping it will cheer them up.",
                 "Avoid mentioning the band around them for a while so they do not feel worse.",
                 "Tell them the selection was fair and they should simply try harder next time."],
     "answer_key": {"points": [2, 0, 1, 0]}},
    {"item_id": "hq-12-14-sjt-04", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "You are halfway through presenting your group's project when you forget what to say next. "
               "Your mind goes blank and your heart is racing. The class is waiting. What would you do?",
     "options": ["Say 'I can't do this' and hand over to a teammate without any explanation.",
                 "Rush through the rest by reading your notes word for word without looking up.",
                 "Pause, take a breath, check your notes, and say, 'Let me pick up from here.'",
                 "Make a joke to distract everyone, then skip the part you forgot entirely."],
     "answer_key": {"points": [0, 1, 2, 0]}},
    {"item_id": "hq-12-14-sjt-05", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You are leading a group project. One member has done very little work, and the others want "
               "to leave their name off the final report. What is the best thing to do?",
     "options": ["Talk privately with the member, find out what is wrong, and agree on a fair task.",
                 "Leave their name off the report as the group wants, without telling them.",
                 "Quietly do their share yourself, and complain about them to the others later.",
                 "Tell the teacher about the situation and ask how the group should handle it."],
     "answer_key": {"points": [2, 0, 0, 1]}},
    {"item_id": "hq-12-14-sjt-06", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "Friends in your class group chat start making fun of a classmate who is not in the group. "
               "They ask you to add a 'funny' comment too. What would you do?",
     "options": ["Add a mild comment so that your friends do not think you are boring.",
                 "Do not comment, and quietly mute the chat until the joking stops.",
                 "Say clearly in the chat that it is unkind, and check on the classmate later.",
                 "Screenshot the chat and share it with other classes to expose your friends."],
     "answer_key": {"points": [0, 1, 2, 0]}},
    {"item_id": "hq-12-14-sjt-07", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You are on a student panel choosing three speakers for the inter-school debate. Two of your "
               "close friends tried out, but a classmate who rarely gets chances gave a stronger trial "
               "speech than one of them. What would you do?",
     "options": ["Pick both friends anyway, because they expect your support and loyalty matters.",
                 "Score every speech on the same criteria, choose the strongest three, and explain why.",
                 "Choose the classmate, but avoid telling your friends why, so there is no argument.",
                 "Ask the panel to pick whoever is most popular in class, to avoid complaints."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-12-14-sjt-08", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "In a football match between sections, the referee, a senior student, misses a foul by your "
               "teammate. The other team protests. Your captain whispers, 'Just keep quiet, it helps us.' "
               "What would you do?",
     "options": ["Keep quiet as the captain says, since the referee's decision is final anyway.",
                 "Argue with the other team that they are making it up just to win.",
                 "Stay out of it during the match, but tell your teammate later it was wrong.",
                 "Tell the referee honestly what happened, and respectfully explain why to your captain."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-12-14-sjt-09", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You prepared for weeks for a science olympiad but did not qualify for the next round. A "
               "friend who studied less did qualify. What would you do?",
     "options": ["Decide that competitions are just luck and stop preparing for any of them.",
                 "Feel upset for a while, then prepare the same way again for next year.",
                 "Find which topics cost you marks, and ask a teacher to help you plan differently.",
                 "Tell others your friend must have somehow seen the questions before the exam."],
     "answer_key": {"points": [0, 1, 2, 0]}},
    {"item_id": "hq-12-14-sjt-10", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You have a maths test, a science project and cricket practice all in the same week. By "
               "Wednesday you are behind on everything and feel overwhelmed. What would you do?",
     "options": ["Pretend to be unwell so you can miss the test and get extra time.",
                 "Work on whatever feels most urgent each hour and hope it all gets done.",
                 "Give up on the project this time, because you cannot do everything well.",
                 "Accept you fell behind, plan tasks by deadline, and ask your coach for a day off."],
     "answer_key": {"points": [0, 1, 0, 2]}},
    {"item_id": "hq-12-14-sjt-11", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "Your team loses the inter-school kabaddi final after you miss a key tackle in the last "
               "minute. On the bus back, a teammate says it was all your fault. What would you do?",
     "options": ["Accept the mistake calmly, and suggest the team reviews the match together to improve.",
                 "Point out all the mistakes your teammate made earlier in the match.",
                 "Say nothing, and quietly decide to leave the team after this season.",
                 "Say sorry to the team, then stay quiet and avoid the topic for the trip."],
     "answer_key": {"points": [2, 0, 0, 1]}},
    {"item_id": "hq-12-14-sjt-12", "age_band": "12-14", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "At the science fair, your group's water-filter model starts leaking just as the judges "
               "arrive. You built that part. The judges give your group two minutes before moving on. "
               "What would you do?",
     "options": ["Tell the judges another group member must have damaged it while setting up.",
                 "Own the fault, explain how the model should work, and say what you would fix.",
                 "Quickly try to stop the leak with tape and hope that it holds.",
                 "Walk away from the stall and let your group deal with the judges."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-12-14-ref-01", "age_band": "12-14", "qtype": "REFLECTIVE", "hq_dimension": "AQ",
     "prompt": "Tell us about a time something did not go to plan, such as a test, a match, a project or a "
               "performance. What did you do next, and what would you do differently now? Write about 80 "
               "to 200 words.",
     "options": [], "answer_key": None},
    {"item_id": "hq-12-14-ref-02", "age_band": "12-14", "qtype": "REFLECTIVE", "hq_dimension": "EQ",
     "prompt": "Describe a situation where you felt a strong emotion, such as anger, worry or "
               "disappointment. How did you manage it, and how did your reaction affect the people around "
               "you? Write about 80 to 200 words.",
     "options": [], "answer_key": None},
    {"item_id": "hq-12-14-ref-03", "age_band": "12-14", "qtype": "REFLECTIVE", "hq_dimension": "SQ",
     "prompt": "Think of a time you worked with people who had different opinions from yours, for example "
               "in a group project or a team. How did the group reach a decision, and what was your role? "
               "Write about 80 to 200 words.",
     "options": [], "answer_key": None},
    {"item_id": "hq-12-14-ideas-01", "age_band": "12-14", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "List as many different uses of a brick as you can. Include unusual ideas as well as "
               "practical ones, and add a short detail to your best ideas. You have 3 minutes.",
     "options": [], "answer_key": None},
    {"item_id": "hq-12-14-ideas-02", "age_band": "12-14", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "List as many different uses of a large empty cardboard box as you can. Think beyond the "
               "obvious, and add a short detail to your most original ideas. You have 3 minutes.",
     "options": [], "answer_key": None},

    # ------------------------------------------------------------------ 15-17
    {"item_id": "hq-15-17-sjt-01", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "Your pre-board results are out and you scored well below your target in physics. Friends "
               "are loudly comparing marks. You feel anxious about the board exams in two months. What is "
               "the best thing to do?",
     "options": ["Acknowledge the worry, step away from the comparison, and plan physics revision with a "
                 "teacher.",
                 "Tell your friends your marks were higher than they actually were, to avoid questions.",
                 "Join the discussion and keep comparing until you know where you stand against everyone.",
                 "Go home, keep the result to yourself, and study physics harder on your own."],
     "answer_key": {"points": [2, 0, 0, 1]}},
    {"item_id": "hq-15-17-sjt-02", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "A close friend, who has been stressed about coaching classes, cancels plans with you for "
               "the third time at the last minute. You feel ignored and irritated. What would you do?",
     "options": ["Send a sharp message saying they clearly do not value the friendship any more.",
                 "Stop making plans with them, and wait to see whether they even notice.",
                 "Tell them honestly you felt let down, and ask how they are coping with coaching.",
                 "Reply 'No problem' and keep your irritation to yourself to avoid an argument."],
     "answer_key": {"points": [0, 0, 2, 1]}},
    {"item_id": "hq-15-17-sjt-03", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "During a heated class debate, an opponent dismisses your argument with a sarcastic remark "
               "and some students laugh. You feel your temper rising, and you have the next turn to speak. "
               "What would you do?",
     "options": ["Use your turn to mock the opponent's way of speaking so the class laughs back.",
                 "Skip your turn and say that you have nothing more to add to the debate.",
                 "Respond only to the facts and ignore the remark, though your tone stays sharp.",
                 "Pause to settle yourself, then calmly answer the point and note that sarcasm does not help."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-15-17-sjt-04", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "EQ",
     "prompt": "A junior you tutor in the school's peer-tutoring programme tells you they are failing a "
               "subject and are scared to tell their family. They ask you to keep it a secret. What would "
               "you do?",
     "options": ["Promise to keep it secret, and help them hide their marks from home.",
                 "Acknowledge their fear, and offer to help them speak to a teacher or parent together.",
                 "Tell their class teacher straight away, without discussing it with them first.",
                 "Tell them failing one subject is not a big deal and they should stop worrying."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-15-17-sjt-05", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You are house captain for sports day. Everyone agreed that only students who attend "
               "practice can compete. A talented athlete in your house has skipped most sessions, while "
               "others attended every one. Final entries are due tomorrow. What would you do?",
     "options": ["Enter the talented athlete anyway, since winning points for the house matters most.",
                 "Apply the agreed rule, and simply post the final list without any further discussion.",
                 "Ask the house teacher to choose, so that nobody can blame you for the decision.",
                 "Talk to the athlete first, then apply the agreed rule to everyone and explain the list."],
     "answer_key": {"points": [0, 1, 0, 2]}},
    {"item_id": "hq-15-17-sjt-06", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "In your class online group, two classmates start a heated argument about changes to the "
               "project groups. Others are taking sides and some messages are becoming personal. You are "
               "one of the group admins. What would you do?",
     "options": ["Remove both classmates from the group straight away, without any explanation to anyone.",
                 "Ask everyone to keep it respectful, and invite the two to talk it through offline.",
                 "Take the side of the classmate you agree with, so the argument ends faster.",
                 "Privately message both to calm down, but leave the group discussion as it is."],
     "answer_key": {"points": [0, 2, 0, 1]}},
    {"item_id": "hq-15-17-sjt-07", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "Your friends plan to bunk the last period to watch a cricket match at a friend's house. "
               "They say you are 'no fun' if you do not join. You do not want to go. What would you do?",
     "options": ["Say clearly that you are staying, without judging them, and suggest watching highlights "
                 "later.",
                 "Go along with them this once, so that you are not left out of the group.",
                 "Quietly stay back in class and avoid replying to any of their messages.",
                 "Tell them they are being foolish and will regret it, then walk off."],
     "answer_key": {"points": [2, 0, 1, 0]}},
    {"item_id": "hq-15-17-sjt-08", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "SQ",
     "prompt": "You lead a five-member team for an inter-school business-plan competition. Two members "
               "dominate every meeting, while one member, who is new to the school, rarely speaks but has "
               "shared thoughtful written notes. What would you do?",
     "options": ["Go with the two vocal members' ideas, since they are clearly the most confident.",
                 "Tell the two members, in front of everyone, that they talk far too much.",
                 "Set a speaking order so everyone contributes, and invite the new member to present.",
                 "Read out the new member's notes yourself, so their ideas are at least heard."],
     "answer_key": {"points": [0, 0, 2, 1]}},
    {"item_id": "hq-15-17-sjt-09", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You did not get the score you needed in a competitive entrance exam after a year of "
               "preparation. Your family is supportive but worried. Some relatives suggest you choose a "
               "completely different career. What would you do?",
     "options": ["Decide you are not capable of that field, and drop the idea immediately.",
                 "Analyse what went wrong, discuss options with family and a mentor, then make a plan.",
                 "Retake the exam next year using exactly the same study routine as before.",
                 "Blame the coaching and the exam pattern, and refuse to discuss it further."],
     "answer_key": {"points": [0, 2, 1, 0]}},
    {"item_id": "hq-15-17-sjt-10", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "As student council secretary, you organised a book-donation drive, but very few books were "
               "collected. At the next council meeting, the principal asks you what happened. What would "
               "you do?",
     "options": ["Admit the publicity was weak, share what you learned, and propose a better second drive.",
                 "Explain that students simply did not care, so nothing more could have been done.",
                 "Apologise for the result, and offer to run the drive again in the same way.",
                 "Point out that other council members did not help enough with the planning."],
     "answer_key": {"points": [2, 0, 1, 0]}},
    {"item_id": "hq-15-17-sjt-11", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "You are captain of the school cricket team. After three losses in a row, team morale is low "
               "and two players say they want to quit. The next match is in a week. What would you do?",
     "options": ["Tell the two players to quit if they are not committed, and pick replacements.",
                 "Hold extra practice every day this week, working harder at the same drills.",
                 "Own your share of the losses, ask the team and coach what to change, and adjust.",
                 "Tell the team the losses were mainly due to poor umpiring and bad pitches."],
     "answer_key": {"points": [0, 1, 2, 0]}},
    {"item_id": "hq-15-17-sjt-12", "age_band": "15-17", "qtype": "SJT", "hq_dimension": "AQ",
     "prompt": "Your essay for a national writing competition received feedback that it was 'well written "
               "but lacked a clear argument'. You worked hard on it and feel discouraged. A new competition "
               "opens next month. What would you do?",
     "options": ["Decide the judges did not understand your style, and submit a similar essay.",
                 "Skip the next competition, since your writing is clearly not good enough yet.",
                 "Enter the next competition and simply try to write more carefully this time.",
                 "Study the feedback, ask a teacher how to build an argument, and redraft before entering."],
     "answer_key": {"points": [0, 0, 1, 2]}},
    {"item_id": "hq-15-17-ref-01", "age_band": "15-17", "qtype": "REFLECTIVE", "hq_dimension": "AQ",
     "prompt": "Describe a significant setback you have faced in studies, sport, a competition or another "
               "area of life. How did you respond at first, what did you change afterwards, and what did "
               "you learn about yourself? Write about 80 to 200 words.",
     "options": [], "answer_key": None},
    {"item_id": "hq-15-17-ref-02", "age_band": "15-17", "qtype": "REFLECTIVE", "hq_dimension": "EQ",
     "prompt": "Tell us about a time when your feelings and someone else's feelings pulled in different "
               "directions, for example a disagreement with a friend or teammate. How did you handle your "
               "own emotions while considering theirs? Write about 80 to 200 words.",
     "options": [], "answer_key": None},
    {"item_id": "hq-15-17-ref-03", "age_band": "15-17", "qtype": "REFLECTIVE", "hq_dimension": "SQ",
     "prompt": "Describe a time you took on a responsibility for a group, such as leading a team, "
               "organising an event or settling a disagreement. How did you make sure everyone was treated "
               "fairly and heard? Write about 80 to 200 words.",
     "options": [], "answer_key": None},
    {"item_id": "hq-15-17-ideas-01", "age_band": "15-17", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "List as many different uses of an old bicycle tyre as you can. Include practical, artistic "
               "and problem-solving ideas, and add a short explanation to your most original ones. You "
               "have 3 minutes.",
     "options": [], "answer_key": None},
    {"item_id": "hq-15-17-ideas-02", "age_band": "15-17", "qtype": "IDEAS", "hq_dimension": "CQ",
     "prompt": "List as many uses as you can for a wooden ruler, other than measuring. Think across science, "
               "sport, art and daily life, and elaborate on your best ideas. You have 3 minutes.",
     "options": [], "answer_key": None},
]


def items_for(age_band: str) -> list[dict]:
    return [i for i in ITEMS if i["age_band"] == age_band]


def age_band_for(age: int | None) -> str:
    """Nearest band for a candidate's age in years (None -> '12-14')."""
    if age is None:
        return "12-14"
    if age <= 8:
        return "6-8"
    if age <= 11:
        return "9-11"
    if age <= 14:
        return "12-14"
    return "15-17"


def validate() -> list[str]:
    """Problems in the bank (empty list = OK). Used by tests."""
    problems: list[str] = []
    seen: set[str] = set()
    for item in ITEMS:
        iid = item.get("item_id")
        if not iid or not isinstance(iid, str):
            problems.append(f"item without a valid item_id: {item!r:.80}")
            continue
        if iid in seen:
            problems.append(f"{iid}: duplicate item_id")
        seen.add(iid)

        band = item.get("age_band")
        qtype = item.get("qtype")
        dim = item.get("hq_dimension")
        if band not in AGE_BANDS:
            problems.append(f"{iid}: unknown age_band {band!r}")
        if qtype not in QTYPES:
            problems.append(f"{iid}: unknown qtype {qtype!r}")
        if dim not in DIMENSIONS:
            problems.append(f"{iid}: unknown hq_dimension {dim!r}")
        if not isinstance(item.get("prompt"), str) or not item["prompt"].strip():
            problems.append(f"{iid}: empty prompt")

        options = item.get("options")
        key = item.get("answer_key")
        if qtype == "SJT":
            if not isinstance(options, list) or len(options) != 4:
                problems.append(f"{iid}: SJT needs exactly 4 options")
            else:
                if any(not isinstance(o, str) or not o.strip() for o in options):
                    problems.append(f"{iid}: SJT has an empty option")
                elif len({o.strip().lower() for o in options}) != 4:
                    problems.append(f"{iid}: SJT options are not distinct")
            points = key.get("points") if isinstance(key, dict) else None
            if not isinstance(points, list) or sorted(points) != [0, 0, 1, 2]:
                problems.append(f"{iid}: SJT answer_key.points must be a permutation of [2, 1, 0, 0]")
            if dim == "CQ":
                problems.append(f"{iid}: SJT items must be EQ, SQ or AQ")
        elif qtype in QTYPES:
            if options != []:
                problems.append(f"{iid}: {qtype} must have options == []")
            if key is not None:
                problems.append(f"{iid}: {qtype} must have answer_key None")
            if qtype == "IDEAS" and dim != "CQ":
                problems.append(f"{iid}: IDEAS items must be tagged CQ")

    for band in AGE_BANDS:
        band_items = items_for(band)
        sjt = [i for i in band_items if i.get("qtype") == "SJT"]
        refl = [i for i in band_items if i.get("qtype") == "REFLECTIVE"]
        ideas = [i for i in band_items if i.get("qtype") == "IDEAS"]
        if len(sjt) != 12:
            problems.append(f"band {band}: expected 12 SJT items, found {len(sjt)}")
        for d in ("EQ", "SQ", "AQ"):
            n = sum(1 for i in sjt if i.get("hq_dimension") == d)
            if n != 4:
                problems.append(f"band {band}: expected 4 SJT {d} items, found {n}")
        if len(refl) != 3:
            problems.append(f"band {band}: expected 3 REFLECTIVE items, found {len(refl)}")
        if sorted(i.get("hq_dimension") for i in refl) != ["AQ", "EQ", "SQ"]:
            problems.append(f"band {band}: REFLECTIVE items must be one each of AQ, EQ, SQ")
        if len(ideas) != 2:
            problems.append(f"band {band}: expected 2 IDEAS items, found {len(ideas)}")
    return problems
